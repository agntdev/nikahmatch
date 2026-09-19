import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now, notifyOwner, sanitizeCaption } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";

type Visibility = "public" | "protected";
type Post = NonNullable<Ctx["session"]["feedPosts"]>[number];
type Rating = NonNullable<Ctx["session"]["feedRatings"]>[number];

registerMainMenuItem({ label: "📰 Лента", data: "feed:open", order: 25 });
const composer = new Composer<Ctx>();

const back = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

function posts(ctx: Ctx): Post[] {
  return ctx.session.feedPosts ?? [];
}

function ratingFor(ctx: Ctx, postId: string): Rating | undefined {
  return ctx.session.feedRatings?.find((r) => r.postId === postId && r.raterUserId === ctx.from?.id);
}

function postText(ctx: Ctx, post: Post): string {
  const rating = ratingFor(ctx, post.postId);
  const average = post.ratingCount ? (post.ratingSum / post.ratingCount).toFixed(1) : "нет оценок";
  const own = post.authorUserId === ctx.from?.id;
  const author = own ? "Ваша запись" : "Участник сообщества";
  const privacy = post.visibility === "protected" ? "\n🔒 Защищённая запись" : "";
  const mine = rating?.liked ? "💛" : "♡";
  const selected = rating?.rating ? ` Вы выбрали ${rating.rating}/5` : "";
  return `${author}${privacy}\n\n${post.captionText || "Без подписи"}\n\n${mine} ${post.likesCount} · ★ ${average}${selected}`;
}

function postKeyboard(post: Post, ctx: Ctx) {
  const rating = ratingFor(ctx, post.postId);
  return inlineKeyboard([
    [inlineButton(rating?.liked ? "💛 Нравится" : "♡ Нравится", `feed:like:${post.postId}`)],
    [inlineButton("★ 1", `feed:rate:${post.postId}:1`), inlineButton("★ 2", `feed:rate:${post.postId}:2`), inlineButton("★ 3", `feed:rate:${post.postId}:3`), inlineButton("★ 4", `feed:rate:${post.postId}:4`), inlineButton("★ 5", `feed:rate:${post.postId}:5`)],
    [inlineButton("Пожаловаться", `feed:report:${post.postId}`), inlineButton("Дальше", "feed:next")],
    [inlineButton("Добавить запись", "feed:create"), inlineButton("⬅️ В меню", "menu:main")],
  ]);
}

async function showPost(ctx: Ctx, post: Post): Promise<void> {
  const protectedImage = post.visibility === "protected" && post.authorUserId !== ctx.from?.id;
  if (protectedImage) {
    await ctx.reply(`🔒 Защищённая запись\n\n${post.captionText || "Без подписи"}\n\nФото откроется после взаимного согласия.`, { reply_markup: postKeyboard(post, ctx) });
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
  if (own.length === 0) {
    await ctx.reply("В ленте пока тихо — добавьте первую запись с фото.", { reply_markup: inlineKeyboard([[inlineButton("Добавить запись", "feed:create")], [inlineButton("⬅️ В меню", "menu:main")]]) });
    return;
  }
  await showPost(ctx, own[0]);
});

composer.callbackQuery("feed:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  const day = now().slice(0, 10);
  const used = ctx.session.feedPostDays?.[day] ?? 0;
  if (used >= 10) { await ctx.reply("На сегодня уже 10 записей — завтра можно будет добавить ещё.", { reply_markup: back }); return; }
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

composer.on("message:document", async (ctx, next) => {
  if (ctx.session.step !== "feed_photo") return next();
  await ctx.reply("Для записи нужно именно изображение. Пришлите фото, а не файл.");
});

async function askVisibility(ctx: Ctx) {
  ctx.session.step = "feed_visibility";
  await ctx.reply("Кто сможет увидеть фото?", { reply_markup: inlineKeyboard([[inlineButton("Открытая", "feed:visibility:public"), inlineButton("Защищённая", "feed:visibility:protected")]]) });
}

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "feed_photo") { await ctx.reply("Сначала пришлите фото для записи."); return; }
  if (ctx.session.step !== "feed_caption") return next();
  const value = sanitizeCaption(ctx.message.text);
  if (ctx.message.text.length > 500) { await ctx.reply("Подпись слишком длинная. Сократите её до 500 символов."); return; }
  ctx.session.draft = { ...(ctx.session.draft ?? {}), feedCaption: value };
  await askVisibility(ctx);
});

composer.callbackQuery("feed:caption:skip", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.draft = { ...(ctx.session.draft ?? {}), feedCaption: "" }; await askVisibility(ctx); });

composer.callbackQuery(/^feed:visibility:(public|protected)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const visibility = ctx.callbackQuery.data.split(":").pop() as Visibility;
  const draft = ctx.session.draft ?? {};
  const photoFileId = typeof draft.feedPhoto === "string" ? draft.feedPhoto : "";
  if (!photoFileId) { ctx.session.step = undefined; await ctx.reply("Фото не найдено. Начните запись ещё раз."); return; }
  const day = now().slice(0, 10);
  const counts = { ...(ctx.session.feedPostDays ?? {}) };
  if ((counts[day] ?? 0) >= 10) { ctx.session.step = undefined; await ctx.reply("На сегодня уже 10 записей — завтра можно будет добавить ещё."); return; }
  const post: Post = { postId: `${ctx.from.id}-${now()}`, authorUserId: ctx.from.id, photoFileId, captionText: typeof draft.feedCaption === "string" ? draft.feedCaption : "", createdAt: now(), visibility, likesCount: 0, ratingSum: 0, ratingCount: 0 };
  ctx.session.feedPosts = [...posts(ctx), post]; counts[day] = (counts[day] ?? 0) + 1; ctx.session.feedPostDays = counts;
  ctx.session.draft = undefined; ctx.session.step = undefined;
  await notifyOwner(ctx, `Новая запись в ленте (${visibility === "protected" ? "защищённая" : "открытая"}).`);
  await ctx.reply("Запись опубликована. Её можно изменить видимостью в следующем просмотре.", { reply_markup: inlineKeyboard([[inlineButton("Открыть запись", `feed:view:${post.postId}`)], [inlineButton("В ленту", "feed:open")]]) });
});

composer.callbackQuery(/^feed:view:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const post = posts(ctx).find((p) => p.postId === ctx.callbackQuery.data.slice("feed:view:".length)); if (!post) { await ctx.reply("Эта запись больше недоступна.", { reply_markup: back }); return; } await showPost(ctx, post); });

composer.callbackQuery(/^feed:like:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const id = ctx.callbackQuery.data.slice("feed:like:".length); const post = posts(ctx).find((p) => p.postId === id); if (!post) { await ctx.reply("Эта запись больше недоступна."); return; }
  const ratings = [...(ctx.session.feedRatings ?? [])]; const at = ratings.findIndex((r) => r.postId === id && r.raterUserId === ctx.from.id); const old = at >= 0 ? ratings[at] : undefined;
  if (old) { old.liked = !old.liked; old.updatedAt = now(); } else ratings.push({ postId: id, raterUserId: ctx.from.id, liked: true, updatedAt: now() });
  post.likesCount = ratings.filter((r) => r.postId === id && r.liked).length; ctx.session.feedRatings = ratings; await showPost(ctx, post);
});

composer.callbackQuery(/^feed:rate:(.+):(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const [, id, raw] = ctx.callbackQuery.data.match(/^feed:rate:(.+):(\d)$/)!; const value = Number(raw); const post = posts(ctx).find((p) => p.postId === id); if (!post) { await ctx.reply("Эта запись больше недоступна."); return; }
  const ratings = [...(ctx.session.feedRatings ?? [])]; const at = ratings.findIndex((r) => r.postId === id && r.raterUserId === ctx.from.id); const old = at >= 0 ? ratings[at] : undefined; if (old?.rating) { post.ratingSum -= old.rating; } else if (!old) ratings.push({ postId: id, raterUserId: ctx.from.id, liked: false, updatedAt: now() }); const current = ratings.find((r) => r.postId === id && r.raterUserId === ctx.from.id)!; current.rating = value; current.updatedAt = now(); post.ratingSum += value; post.ratingCount = ratings.filter((r) => r.postId === id && r.rating !== undefined).length; ctx.session.feedRatings = ratings; await showPost(ctx, post);
});

composer.callbackQuery(/^feed:report:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const id = ctx.callbackQuery.data.slice("feed:report:".length); ctx.session.feedReports = [...(ctx.session.feedReports ?? []), { postId: id, reporterUserId: ctx.from.id, createdAt: now(), status: "open" }]; await notifyOwner(ctx, `Новая жалоба на запись в ленте. Её можно проверить в комнате админа.`); await ctx.reply("Спасибо, что рассказали. Команда сообщества проверит запись.", { reply_markup: back }); });

composer.callbackQuery(/^admin:feed:delete:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx as never))) return; const id = ctx.callbackQuery.data.slice("admin:feed:delete:".length); ctx.session.feedPosts = posts(ctx).filter((p) => p.postId !== id); await ctx.reply("Запись удалена из ленты."); });

export default composer;
