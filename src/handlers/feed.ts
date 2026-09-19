import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { answerCallbackSafely, now, notifyOwner, sanitizeCaption } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";

type Visibility = "public" | "protected";
type Post = NonNullable<Ctx["session"]["feedPosts"]>[number];
type Like = NonNullable<Ctx["session"]["feedLikes"]>[number];

registerMainMenuItem({ label: "📰 Лента", data: "feed:open", order: 25 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

function posts(ctx: Ctx): Post[] { return ctx.session.feedPosts ?? []; }
function likes(ctx: Ctx): Like[] { return ctx.session.feedLikes ?? []; }
function postLikes(ctx: Ctx, postId: string): Like[] {
  return likes(ctx).filter((like) => like.postId === postId);
}
function userLiked(ctx: Ctx, postId: string): boolean {
  return postLikes(ctx, postId).some((like) => like.userId === ctx.from?.id);
}
function postForViewer(ctx: Ctx, post: Post) {
  return { ...post, like_count: likeCount(ctx, post), user_liked: userLiked(ctx, post.postId) };
}
function likeCount(ctx: Ctx, post: Post): number {
  const count = postLikes(ctx, post.postId).length;
  // Migrate the old counter when a post predates the separate like records.
  return count || (ctx.session.feedLikes ? 0 : post.likesCount);
}
function postText(ctx: Ctx, post: Post): string {
  const view = postForViewer(ctx, post);
  const own = post.authorUserId === ctx.from?.id;
  const author = own ? "Ваша запись" : "Участник сообщества";
  const privacy = post.visibility === "protected" && !own ? "\n🔒 Защищённая запись" : "";
  const count = view.like_count;
  return `${author}${privacy}\n\n${post.captionText || "Без подписи"}\n\nНравится: ${count}`;
}
function postKeyboard(post: Post, ctx: Ctx) {
  const view = postForViewer(ctx, post);
  const liked = view.user_liked;
  const likeLabel = liked ? "♥️ Нравится" : "♡ Нравится";
  return inlineKeyboard([
    [inlineButton(likeLabel, `feed:like:${post.postId}`)],
    [inlineButton("Пожаловаться", `feed:report:${post.postId}`), inlineButton("Дальше", "feed:next")],
    [inlineButton("Добавить запись", "feed:create"), inlineButton("⬅️ В меню", "menu:main")],
  ]);
}
async function showPost(ctx: Ctx, post: Post): Promise<void> {
  const view = postForViewer(ctx, post);
  const hiddenPhoto = post.visibility === "protected" && post.authorUserId !== ctx.from?.id;
  const text = hiddenPhoto
    ? `🔒 Защищённая запись\n\n${post.captionText || "Без подписи"}\n\nФото откроется после взаимного согласия.\n\nНравится: ${view.like_count}`
    : postText(ctx, post);
  if (hiddenPhoto) {
    await ctx.reply(text, { reply_markup: postKeyboard(post, ctx) });
    return;
  }
  try {
    await ctx.api.sendPhoto(ctx.chat!.id, post.photoFileId, { caption: text, reply_markup: postKeyboard(post, ctx) });
  } catch {
    await ctx.reply(text, { reply_markup: postKeyboard(post, ctx) });
  }
}

composer.callbackQuery("feed:open", async (ctx) => {
  await answerCallbackSafely(ctx);
  const own = posts(ctx).filter((p) => p.authorUserId === ctx.from?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!own.length) {
    await ctx.reply("В ленте пока тихо — добавьте первую запись с фото.", { reply_markup: inlineKeyboard([[inlineButton("Добавить запись", "feed:create")], [inlineButton("⬅️ В меню", "menu:main")]]) });
    return;
  }
  ctx.session.feedCursor = 0;
  await showPost(ctx, own[0]);
});

composer.callbackQuery("feed:create", async (ctx) => {
  await answerCallbackSafely(ctx);
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
composer.callbackQuery("feed:caption:skip", async (ctx) => { await answerCallbackSafely(ctx); ctx.session.draft = { ...(ctx.session.draft ?? {}), feedCaption: "" }; await askVisibility(ctx); });
composer.callbackQuery(/^feed:visibility:(public|protected)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  const userId = ctx.from?.id;
  if (userId === undefined) { await ctx.reply("Не удалось определить автора записи. Попробуйте ещё раз."); return; }
  const visibility = ctx.callbackQuery.data.endsWith(":public") ? "public" : "protected";
  const draft = ctx.session.draft ?? {};
  if (typeof draft.feedPhoto !== "string") { ctx.session.step = undefined; await ctx.reply("Фото не найдено. Начните запись ещё раз."); return; }
  const day = now().slice(0, 10); const counts = { ...(ctx.session.feedPostDays ?? {}) };
  if ((counts[day] ?? 0) >= 10) { ctx.session.step = undefined; await ctx.reply("На сегодня уже 10 записей — завтра можно будет добавить ещё."); return; }
  const post: Post = { postId: `${userId}-${now()}`, authorUserId: userId, photoFileId: draft.feedPhoto, captionText: typeof draft.feedCaption === "string" ? draft.feedCaption : "", createdAt: now(), visibility, likesCount: 0, dislikesCount: 0 };
  ctx.session.feedPosts = [...posts(ctx), post]; counts[day] = (counts[day] ?? 0) + 1; ctx.session.feedPostDays = counts;
  ctx.session.draft = undefined; ctx.session.step = undefined;
  await notifyOwner(ctx, `Новая запись в ленте (${visibility === "protected" ? "защищённая" : "открытая"}).`);
  await ctx.reply("Запись опубликована. Её можно открыть из ленты.", { reply_markup: inlineKeyboard([[inlineButton("Открыть запись", `feed:view:${post.postId}`)], [inlineButton("В ленту", "feed:open")]]) });
});
composer.callbackQuery(/^feed:view:(.+)$/, async (ctx) => { await answerCallbackSafely(ctx); const post = posts(ctx).find((item) => item.postId === ctx.callbackQuery.data.slice(10)); if (!post) { await ctx.reply("Эта запись больше недоступна.", { reply_markup: back }); return; } await showPost(ctx, post); });
composer.callbackQuery("feed:next", async (ctx) => {
  await answerCallbackSafely(ctx);
  const available = posts(ctx).filter((post) => post.authorUserId === ctx.from?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!available.length) { await ctx.reply("В ленте пока тихо — добавьте первую запись с фото.", { reply_markup: back }); return; }
  const next = ((ctx.session.feedCursor ?? 0) + 1) % available.length;
  ctx.session.feedCursor = next;
  await showPost(ctx, available[next]);
});

async function toggleLike(ctx: Ctx, id: string): Promise<void> {
  const userId = ctx.from?.id;
  if (userId === undefined) { await ctx.reply("Не удалось определить пользователя. Попробуйте ещё раз."); return; }
  const post = posts(ctx).find((item) => item.postId === id);
  if (!post) { await ctx.reply("Эта запись больше недоступна."); return; }
  if (post.authorUserId === userId) { await ctx.reply("Свою запись оценивать нельзя."); return; }
  // This is the unique (userId, postId) record. Replacing the session value in
  // one turn makes duplicate taps idempotent and keeps the counter in sync.
  const current = likes(ctx);
  const index = current.findIndex((like) => like.postId === id && like.userId === userId);
  const next = index >= 0 ? current.filter((_, i) => i !== index) : [...current, { postId: id, userId, createdAt: now() }];
  ctx.session.feedLikes = next;
  post.likesCount = postLikes(ctx, id).length;
  await showPost(ctx, post);
}

composer.callbackQuery(/^feed:like:(.+)$/, async (ctx) => { await answerCallbackSafely(ctx); await toggleLike(ctx, ctx.callbackQuery.data.slice(10)); });
// Accept old links without exposing the removed dislike control.
composer.callbackQuery(/^feed:react:(.+):(like|dislike)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  const match = ctx.callbackQuery.data.match(/^feed:react:(.+):(like|dislike)$/)!;
  if (match[2] === "dislike") { await ctx.reply("В ленте доступна только кнопка «Нравится»."); return; }
  await toggleLike(ctx, match[1]);
});

composer.callbackQuery(/^feed:report:(.+)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  const id = ctx.callbackQuery.data.slice(12);
  const post = posts(ctx).find((item) => item.postId === id);
  ctx.session.feedReports = [...(ctx.session.feedReports ?? []), { postId: id, reporterUserId: ctx.from.id, createdAt: now(), status: "open", likesCount: post ? likeCount(ctx, post) : 0 }];
  await notifyOwner(ctx, `Новая жалоба на запись в ленте. Нравится: ${post ? likeCount(ctx, post) : 0}.`);
  await ctx.reply("Спасибо, что рассказали. Команда сообщества проверит запись.", { reply_markup: back });
});

composer.callbackQuery("admin:feed:reactions", async (ctx) => {
  await answerCallbackSafely(ctx);
  if (!(await requireOwner(ctx as never))) return;
  const all = likes(ctx);
  if (!all.length) { await ctx.reply("В ленте пока нет отметок «Нравится»."); return; }
  const recent = all.slice(-20);
  await ctx.reply(`Последние отметки «Нравится»:\n\n${recent.map((_, i) => `${i + 1}. Нравится`).join("\n\n")}`, { reply_markup: inlineKeyboard(recent.map((_, i) => [inlineButton(`Удалить отметку ${i + 1}`, `admin:feed:like:delete:${i}`)])) });
});
composer.callbackQuery(/^admin:feed:like:delete:(\d+)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  if (!(await requireOwner(ctx as never))) return;
  const index = Number(ctx.callbackQuery.data.split(":").pop()); const recent = likes(ctx).slice(-20); const selected = recent[index];
  if (!selected) { await ctx.reply("Эта отметка уже удалена."); return; }
  ctx.session.feedLikes = likes(ctx).filter((like) => !(like.postId === selected.postId && like.userId === selected.userId));
  const post = posts(ctx).find((item) => item.postId === selected.postId); if (post) post.likesCount = postLikes(ctx, post.postId).length;
  await ctx.reply("Отметка удалена, а счётчик обновлён.");
});
composer.callbackQuery(/^admin:feed:delete:(.+)$/, async (ctx) => { await answerCallbackSafely(ctx); if (!(await requireOwner(ctx as never))) return; const id = ctx.callbackQuery.data.slice(17); ctx.session.feedPosts = posts(ctx).filter((p) => p.postId !== id); ctx.session.feedLikes = likes(ctx).filter((like) => like.postId !== id); await ctx.reply("Запись удалена из ленты."); });

export default composer;
