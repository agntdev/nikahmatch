import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now, notifyOwner, sanitizeCaption } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";

type Visibility = "public" | "protected";
type Post = NonNullable<Ctx["session"]["feedPosts"]>[number];
type Reaction = NonNullable<Ctx["session"]["feedReactions"]>[number];

registerMainMenuItem({ label: "📰 Лента", data: "feed:open", order: 25 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

function posts(ctx: Ctx): Post[] { return ctx.session.feedPosts ?? []; }
function reactionFor(ctx: Ctx, postId: string): Reaction | undefined {
  return ctx.session.feedReactions?.find((r) => r.postId === postId && r.userId === ctx.from?.id);
}
function postText(ctx: Ctx, post: Post): string {
  const own = post.authorUserId === ctx.from?.id;
  const author = own ? "Ваша запись" : "Участник сообщества";
  const privacy = post.visibility === "protected" && !own ? "\n🔒 Защищённая запись" : "";
  const mine = reactionFor(ctx, post.postId);
  const selected = mine ? `\nВаш выбор: ${mine.reaction === "like" ? "нравится" : "не нравится"}` : "";
  return `${author}${privacy}\n\n${post.captionText || "Без подписи"}\n\n👍 ${post.likesCount} · 👎 ${post.dislikesCount}${selected}`;
}
function postKeyboard(post: Post, ctx: Ctx) {
  const own = post.authorUserId === ctx.from?.id;
  return inlineKeyboard([
    ...(own ? [] : [[inlineButton("👍 Нравится", `feed:react:${post.postId}:like`), inlineButton("👎 Не нравится", `feed:react:${post.postId}:dislike`)]]),
    [inlineButton("Пожаловаться", `feed:report:${post.postId}`), inlineButton("Дальше", "feed:next")],
    [inlineButton("Добавить запись", "feed:create"), inlineButton("⬅️ В меню", "menu:main")],
  ]);
}
async function showPost(ctx: Ctx, post: Post): Promise<void> {
  const hiddenPhoto = post.visibility === "protected" && post.authorUserId !== ctx.from?.id;
  if (hiddenPhoto) {
    await ctx.reply(`🔒 Защищённая запись\n\n${post.captionText || "Без подписи"}\n\nФото откроется после взаимного согласия.\n\n👍 ${post.likesCount} · 👎 ${post.dislikesCount}`, { reply_markup: postKeyboard(post, ctx) });
    return;
  }
  try {
    await ctx.api.sendPhoto(ctx.chat!.id, post.photoFileId, { caption: postText(ctx, post), reply_markup: postKeyboard(post, ctx) });
  } catch {
    await ctx.reply(postText(ctx, post), { reply_markup: postKeyboard(post, ctx) });
  }
}

composer.callbackQuery("feed:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = posts(ctx).filter((p) => p.authorUserId === ctx.from?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!own.length) {
    await ctx.reply("В ленте пока тихо — добавьте первую запись с фото.", { reply_markup: inlineKeyboard([[inlineButton("Добавить запись", "feed:create")], [inlineButton("⬅️ В меню", "menu:main")]]) });
    return;
  }
  await showPost(ctx, own[0]);
});

composer.callbackQuery("feed:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  const day = now().slice(0, 10);
  if ((ctx.session.feedPostDays?.[day] ?? 0) >= 10) { await ctx.reply("На сегодня уже 10 записей — завтра можно будет добавить ещё.", { reply_markup: back }); return; }
  ctx.session.step = "feed_photo";
  await ctx.reply("Пришлите одно фото для записи. Подойдут только изображения.", { reply_markup: back });
});

composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.step !== "feed_photo") return next();
  const photo = ctx.message.photo.at(-1);
  if (!photo) { await ctx.reply("Не получилось сохранить фото. Попробуйте отправить его ещё раз."); return; }
  ctx.session.draft = { ...(ctx.session.draft ?? {}), feedPhoto: photo.file_id };
  ctx.session.step = "feed_caption";
  await ctx.reply("Добавьте подпись — это необязательно, до 500 символов.", { reply_markup: inlineKeyboard([[inlineButton("Пропустить подпись", "feed:caption:skip")]]) });
});
composer.on("message:document", async (ctx, next) => { if (ctx.session.step === "feed_photo") await ctx.reply("Для записи нужно именно изображение. Пришлите фото, а не файл."); else await next(); });
async function askVisibility(ctx: Ctx) { ctx.session.step = "feed_visibility"; await ctx.reply("Кто сможет увидеть фото?", { reply_markup: inlineKeyboard([[inlineButton("Открытая", "feed:visibility:public"), inlineButton("Защищённая", "feed:visibility:protected")]]) }); }
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "feed_photo") { await ctx.reply("Сначала пришлите фото для записи."); return; }
  if (ctx.session.step !== "feed_caption") return next();
  if (ctx.message.text.length > 500) { await ctx.reply("Подпись слишком длинная. Сократите её до 500 символов."); return; }
  ctx.session.draft = { ...(ctx.session.draft ?? {}), feedCaption: sanitizeCaption(ctx.message.text) };
  await askVisibility(ctx);
});
composer.callbackQuery("feed:caption:skip", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.draft = { ...(ctx.session.draft ?? {}), feedCaption: "" }; await askVisibility(ctx); });
composer.callbackQuery(/^feed:visibility:(public|protected)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const visibility = ctx.callbackQuery.data.endsWith(":public") ? "public" : "protected";
  const draft = ctx.session.draft ?? {};
  if (typeof draft.feedPhoto !== "string") { ctx.session.step = undefined; await ctx.reply("Фото не найдено. Начните запись ещё раз."); return; }
  const day = now().slice(0, 10); const counts = { ...(ctx.session.feedPostDays ?? {}) };
  if ((counts[day] ?? 0) >= 10) { ctx.session.step = undefined; await ctx.reply("На сегодня уже 10 записей — завтра можно будет добавить ещё."); return; }
  const post: Post = { postId: `${ctx.from.id}-${now()}`, authorUserId: ctx.from.id, photoFileId: draft.feedPhoto, captionText: typeof draft.feedCaption === "string" ? draft.feedCaption : "", createdAt: now(), visibility, likesCount: 0, dislikesCount: 0 };
  ctx.session.feedPosts = [...posts(ctx), post]; counts[day] = (counts[day] ?? 0) + 1; ctx.session.feedPostDays = counts;
  ctx.session.draft = undefined; ctx.session.step = undefined;
  await notifyOwner(ctx, `Новая запись в ленте (${visibility === "protected" ? "защищённая" : "открытая"}).`);
  await ctx.reply("Запись опубликована. Её можно открыть из ленты.", { reply_markup: inlineKeyboard([[inlineButton("Открыть запись", `feed:view:${post.postId}`)], [inlineButton("В ленту", "feed:open")]]) });
});
composer.callbackQuery(/^feed:view:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const post = posts(ctx).find((p) => p.postId === ctx.callbackQuery.data.slice(10)); if (!post) { await ctx.reply("Эта запись больше недоступна.", { reply_markup: back }); return; } await showPost(ctx, post); });

// A single session row is the harness equivalent of the post_reactions unique
// key. Replacing/removing it and adjusting both counters happens in one update.
composer.callbackQuery(/^feed:react:(.+):(like|dislike)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, id, rawReaction] = ctx.callbackQuery.data.match(/^feed:react:(.+):(like|dislike)$/)!;
  const reaction = rawReaction as "like" | "dislike";
  const post = posts(ctx).find((p) => p.postId === id);
  if (!post) { await ctx.reply("Эта запись больше недоступна."); return; }
  if (post.authorUserId === ctx.from.id) { await ctx.reply("Свою запись оценивать нельзя."); return; }
  const reactions = [...(ctx.session.feedReactions ?? [])];
  const index = reactions.findIndex((r) => r.postId === id && r.userId === ctx.from.id);
  const old = index >= 0 ? reactions[index] : undefined;
  if (old?.reaction === reaction) reactions.splice(index, 1);
  else if (old) reactions[index] = { ...old, reaction, updatedAt: now() };
  else reactions.push({ postId: id, userId: ctx.from.id, reaction, updatedAt: now() });
  post.likesCount = reactions.filter((r) => r.postId === id && r.reaction === "like").length;
  post.dislikesCount = reactions.filter((r) => r.postId === id && r.reaction === "dislike").length;
  ctx.session.feedReactions = reactions;
  await showPost(ctx, post);
});
composer.callbackQuery(/^feed:report:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.callbackQuery.data.slice(12);
  const post = posts(ctx).find((item) => item.postId === id);
  ctx.session.feedReports = [...(ctx.session.feedReports ?? []), {
    postId: id, reporterUserId: ctx.from.id, createdAt: now(), status: "open",
    likesCount: post?.likesCount ?? 0, dislikesCount: post?.dislikesCount ?? 0,
  }];
  await notifyOwner(ctx, `Новая жалоба на запись в ленте. Реакции: 👍 ${post?.likesCount ?? 0} · 👎 ${post?.dislikesCount ?? 0}.`);
  await ctx.reply("Спасибо, что рассказали. Команда сообщества проверит запись.", { reply_markup: back });
});
composer.callbackQuery("admin:feed:reactions", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as never))) return;
  const reactions = ctx.session.feedReactions ?? [];
  if (!reactions.length) { await ctx.reply("В ленте пока нет реакций."); return; }
  const recent = reactions.slice(-20);
  const lines = recent.map((r, index) => `${index + 1}. Реакция: ${r.reaction === "like" ? "нравится" : "не нравится"}`);
  await ctx.reply(`Последние реакции:\n\n${lines.join("\n\n")}`, { reply_markup: inlineKeyboard(recent.map((r, index) => [inlineButton(`Удалить реакцию ${index + 1}`, `admin:feed:reaction:delete:${index}`)])) });
});
composer.callbackQuery(/^admin:feed:reaction:delete:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as never))) return;
  const index = Number(ctx.callbackQuery.data.split(":").pop());
  const recent = (ctx.session.feedReactions ?? []).slice(-20);
  const selected = recent[index];
  if (!selected) { await ctx.reply("Эта реакция уже удалена."); return; }
  const postId = selected.postId; const userId = selected.userId;
  const post = posts(ctx).find((item) => item.postId === postId);
  ctx.session.feedReactions = (ctx.session.feedReactions ?? []).filter((r) => !(r.postId === postId && r.userId === userId));
  if (post) {
    post.likesCount = (ctx.session.feedReactions ?? []).filter((r) => r.postId === postId && r.reaction === "like").length;
    post.dislikesCount = (ctx.session.feedReactions ?? []).filter((r) => r.postId === postId && r.reaction === "dislike").length;
  }
  await ctx.reply("Реакция удалена, а счётчики обновлены.");
});
composer.callbackQuery(/^admin:feed:delete:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx as never))) return; const id = ctx.callbackQuery.data.slice(17); ctx.session.feedPosts = posts(ctx).filter((p) => p.postId !== id); ctx.session.feedReactions = (ctx.session.feedReactions ?? []).filter((r) => r.postId !== id); await ctx.reply("Запись удалена из ленты."); });

export default composer;
