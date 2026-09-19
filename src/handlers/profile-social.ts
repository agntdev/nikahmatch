import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { answerCallbackSafely, now, profileFromSession } from "../domain.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { requireOwner } from "../toolkit/index.js";

type Photo = NonNullable<Ctx["session"]["profilePhotos"]>[number];

const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("⬅️ К профилю", "profile:view")]]);

function userId(ctx: Ctx): number { return ctx.from?.id ?? ctx.chat?.id ?? 0; }
function blocked(ctx: Ctx, target: number): boolean {
  return (ctx.session.blacklist ?? []).some((entry) => entry.userId === target);
}
function favorite(ctx: Ctx, target: number): boolean {
  return (ctx.session.favorites ?? []).some((entry) => entry.userId === target);
}
function photoRows(ctx: Ctx): ReturnType<typeof inlineKeyboard> {
  const photos = ctx.session.profilePhotos ?? [];
  return inlineKeyboard([
    ...photos.map((photo) => [
      inlineButton(`${photo.isPrimary ? "⭐ " : ""}Фото ${photo.photoId}`, `photo:detail:${photo.photoId}`),
      inlineButton("Удалить", `photo:delete:${photo.photoId}`),
    ]),
    [inlineButton("Добавить фото", "photo:upload")],
    [inlineButton("⬅️ К профилю", "profile:view")],
  ]);
}
function photoAverage(ctx: Ctx, photoId: string): { average: string; count: number } {
  const scores = (ctx.session.photoRatings ?? []).filter((rating) => rating.photoId === photoId).map((rating) => rating.score);
  return { average: scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : "—", count: scores.length };
}
function socialProfileText(ctx: Ctx, target: number): string {
  if (target === userId(ctx)) return "Это ваш профиль.";
  return "Профиль участника\n\nПолные имя и фото откроются только после взаимного согласия.";
}

composer.callbackQuery("profile:chats", async (ctx) => {
  await answerCallbackSafely(ctx);
  await ctx.reply("Чатов пока нет. Взаимная симпатия откроет безопасный разговор.", { reply_markup: back });
});

composer.callbackQuery("profile:notifications", async (ctx) => {
  await answerCallbackSafely(ctx);
  const settings = ctx.session.socialNotifications ?? { favorite: true, rating: true };
  ctx.session.socialNotifications = settings;
  await ctx.reply("Выберите, о чём напоминать:", { reply_markup: inlineKeyboard([
    [inlineButton(`${settings.favorite ? "✅" : "▫️"} Новые избранные`, "social:notify:favorite")],
    [inlineButton(`${settings.rating ? "✅" : "▫️"} Новые оценки фото`, "social:notify:rating")],
    [inlineButton("⬅️ К профилю", "profile:view")],
  ]) });
});
composer.callbackQuery(/^social:notify:(favorite|rating)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  const key = ctx.callbackQuery.data.endsWith(":favorite") ? "favorite" : "rating";
  const settings = ctx.session.socialNotifications ?? { favorite: true, rating: true };
  settings[key] = !settings[key];
  ctx.session.socialNotifications = settings;
  await ctx.reply("Настройка сохранена.", { reply_markup: inlineKeyboard([[inlineButton("К уведомлениям", "profile:notifications")], [inlineButton("К профилю", "profile:view")]]) });
});

composer.callbackQuery("profile:favorites", async (ctx) => {
  await answerCallbackSafely(ctx);
  const entries = ctx.session.favorites ?? [];
  if (!entries.length) {
    await ctx.reply("В избранном пока пусто — открывайте анкеты и сохраняйте тех, кого хотите не потерять.", { reply_markup: inlineKeyboard([[inlineButton("Найти знакомство", "browse:start")], [inlineButton("⬅️ К профилю", "profile:view")]]) });
    return;
  }
  await ctx.reply("Ваши избранные анкеты:", { reply_markup: inlineKeyboard([
    ...entries.map((entry) => [inlineButton("Открыть анкету", `profile:open:${entry.userId}`), inlineButton("Убрать", `favorite:remove:${entry.userId}`)]),
    [inlineButton("⬅️ К профилю", "profile:view")],
  ]) });
});

composer.callbackQuery(/^favorite:(add|remove):(-?\d+)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  const [, action, raw] = ctx.callbackQuery.data.split(":");
  const target = Number(raw);
  if (!Number.isSafeInteger(target) || target === userId(ctx)) { await ctx.reply("Свою анкету нельзя добавить в избранное."); return; }
  if (blocked(ctx, target)) { await ctx.reply("Этот профиль скрыт для вас."); return; }
  const entries = ctx.session.favorites ?? [];
  if (action === "add" && !favorite(ctx, target)) entries.push({ userId: target, addedAt: now() });
  if (action === "remove") ctx.session.favorites = entries.filter((entry) => entry.userId !== target);
  else ctx.session.favorites = entries;
  await ctx.reply(action === "add" ? "Анкета добавлена в избранное." : "Анкета убрана из избранного.", { reply_markup: back });
});

composer.callbackQuery("profile:blacklist", async (ctx) => {
  await answerCallbackSafely(ctx);
  const entries = ctx.session.blacklist ?? [];
  if (!entries.length) { await ctx.reply("Чёрный список пуст. Здесь можно скрыть нежелательные контакты.", { reply_markup: back }); return; }
  await ctx.reply("Чёрный список:", { reply_markup: inlineKeyboard([
    ...entries.map((entry) => [inlineButton("Открыть анкету", `profile:open:${entry.userId}`), inlineButton("Разблокировать", `blacklist:remove:${entry.userId}`)]),
    [inlineButton("⬅️ К профилю", "profile:view")],
  ]) });
});

composer.callbackQuery(/^blacklist:(add|remove):(-?\d+)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  const [, action, raw] = ctx.callbackQuery.data.split(":");
  const target = Number(raw);
  if (!Number.isSafeInteger(target) || target === userId(ctx)) { await ctx.reply("Нельзя изменить доступ к своей анкете."); return; }
  const entries = ctx.session.blacklist ?? [];
  if (action === "add") {
    if (!blocked(ctx, target)) entries.push({ userId: target, blockedAt: now() });
    ctx.session.blacklist = entries;
    ctx.session.favorites = (ctx.session.favorites ?? []).filter((entry) => entry.userId !== target);
    await ctx.reply("Профиль скрыт. Этот пользователь больше не появится у вас в ленте и не сможет начать с вами чат.", { reply_markup: back });
  } else {
    ctx.session.blacklist = entries.filter((entry) => entry.userId !== target);
    await ctx.reply("Профиль снова доступен.", { reply_markup: back });
  }
});

composer.callbackQuery("profile:visitors", async (ctx) => {
  await answerCallbackSafely(ctx);
  const visitors = (ctx.session.visitors ?? []).filter((entry) => !blocked(ctx, entry.viewerId)).slice(-20).reverse();
  if (!visitors.length) { await ctx.reply("Гостей пока нет — когда кто-то откроет вашу анкету, вы увидите его здесь.", { reply_markup: back }); return; }
  await ctx.reply("Недавние гости:", { reply_markup: inlineKeyboard([
    ...visitors.map((entry) => [inlineButton(`Открыть гостя · ${entry.viewedAt.slice(0, 16).replace("T", " ")}`, `profile:open:${entry.viewerId}`)]),
    [inlineButton("Очистить список", "visitors:clear")], [inlineButton("⬅️ К профилю", "profile:view")],
  ]) });
});
composer.callbackQuery("visitors:clear", async (ctx) => { await answerCallbackSafely(ctx); ctx.session.visitors = []; await ctx.reply("Список гостей очищен.", { reply_markup: back }); });

composer.callbackQuery(/^profile:open:(-?\d+)$/, async (ctx) => {
  await answerCallbackSafely(ctx);
  const target = Number(ctx.callbackQuery.data.split(":").pop());
  if (!Number.isSafeInteger(target) || target === userId(ctx)) { await ctx.reply("Это ваш профиль.", { reply_markup: inlineKeyboard([[inlineButton("К профилю", "profile:view")]]) }); return; }
  if (blocked(ctx, target)) { await ctx.reply("Этот профиль скрыт для вас.", { reply_markup: back }); return; }
  const visitors = ctx.session.visitors ?? [];
  ctx.session.visitors = [...visitors.filter((entry) => entry.viewerId !== target), { viewerId: target, viewedAt: now() }].slice(-100);
  await ctx.reply(socialProfileText(ctx, target), { reply_markup: inlineKeyboard([
    [inlineButton(favorite(ctx, target) ? "Убрать из избранного" : "В избранное", `favorite:${favorite(ctx, target) ? "remove" : "add"}:${target}`)],
    [inlineButton("Чёрный список", `blacklist:add:${target}`), inlineButton("Пожаловаться", `profile:report:${target}`)],
    [inlineButton("Назад", "profile:view")],
  ]) });
});

composer.callbackQuery("profile:photos", async (ctx) => {
  await answerCallbackSafely(ctx);
  const photos = ctx.session.profilePhotos ?? [];
  if (!photos.length) { await ctx.reply("Фото пока нет — добавьте до 10 снимков. Они останутся на модерации и будут скрыты до проверки.", { reply_markup: inlineKeyboard([[inlineButton("Добавить фото", "photo:upload")], [inlineButton("⬅️ К профилю", "profile:view")]]) }); return; }
  await ctx.reply(`Ваши фотографии: ${photos.length}/10\nОценки появятся рядом с каждым фото.`, { reply_markup: photoRows(ctx) });
});

composer.callbackQuery("photo:upload", async (ctx) => { await answerCallbackSafely(ctx); if ((ctx.session.profilePhotos ?? []).length >= 10) { await ctx.reply("У вас уже 10 фото — сначала удалите одно, чтобы добавить новое.", { reply_markup: back }); return; } ctx.session.step = "social_photo_upload"; await ctx.reply("Пришлите фото. Оно будет скрыто до проверки модератором.", { reply_markup: back }); });
composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.step !== "social_photo_upload") return next();
  const file = ctx.message.photo.at(-1);
  if (!file) { await ctx.reply("Не получилось получить фото. Попробуйте отправить его ещё раз."); return; }
  const photos = ctx.session.profilePhotos ?? [];
  const photo: Photo = { photoId: `${userId(ctx)}-${now()}`, ownerId: userId(ctx), fileId: file.file_id, uploadedAt: now(), isPrimary: photos.length === 0, moderationStatus: "pending" };
  ctx.session.profilePhotos = [...photos, photo]; ctx.session.step = undefined;
  await ctx.reply("Фото сохранено и отправлено на проверку. Оно пока скрыто от других участников.", { reply_markup: photoRows(ctx) });
});
composer.callbackQuery(/^photo:delete:(.+)$/, async (ctx) => { await answerCallbackSafely(ctx); const id = ctx.callbackQuery.data.slice("photo:delete:".length); ctx.session.profilePhotos = (ctx.session.profilePhotos ?? []).filter((photo) => photo.photoId !== id); await ctx.reply("Фото удалено.", { reply_markup: photoRows(ctx) }); });
composer.callbackQuery(/^photo:primary:(.+)$/, async (ctx) => { await answerCallbackSafely(ctx); const id = ctx.callbackQuery.data.slice("photo:primary:".length); ctx.session.profilePhotos = (ctx.session.profilePhotos ?? []).map((photo) => ({ ...photo, isPrimary: photo.photoId === id })); await ctx.reply("Главное фото обновлено.", { reply_markup: photoRows(ctx) }); });
composer.callbackQuery(/^photo:detail:(.+)$/, async (ctx) => { await answerCallbackSafely(ctx); const id = ctx.callbackQuery.data.slice("photo:detail:".length); const photo = (ctx.session.profilePhotos ?? []).find((item) => item.photoId === id); if (!photo) { await ctx.reply("Это фото больше недоступно.", { reply_markup: back }); return; } const rating = photoAverage(ctx, id); await ctx.reply(`Фото ${photo.isPrimary ? "(главное)" : ""}\nОценка: ${rating.average} из 5 · ${rating.count} оценок`, { reply_markup: inlineKeyboard([[inlineButton("Сделать главным", `photo:primary:${id}`)], [1, 2, 3, 4, 5].map((score) => inlineButton(`${score} ⭐`, `photo:rate:${id}:${score}`)) as never, [inlineButton("Назад", "profile:photos")]]) }); });
composer.callbackQuery(/^photo:rate:(.+):(\d)$/, async (ctx) => { await answerCallbackSafely(ctx); const [, id, scoreRaw] = ctx.callbackQuery.data.match(/^photo:rate:(.+):(\d)$/)!; const score = Number(scoreRaw); const photos = ctx.session.profilePhotos ?? []; if (!photos.some((photo) => photo.photoId === id && photo.moderationStatus === "ok")) { await ctx.reply("Это фото пока нельзя оценить: оно ещё проходит проверку.", { reply_markup: back }); return; } const ratings = ctx.session.photoRatings ?? []; const previous = ratings.findIndex((rating) => rating.photoId === id && rating.raterId === userId(ctx)); const next = { photoId: id, raterId: userId(ctx), score, ratedAt: now() }; ctx.session.photoRatings = previous >= 0 ? ratings.map((rating, index) => index === previous ? next : rating) : [...ratings, next]; const aggregate = photoAverage(ctx, id); await ctx.reply(`Ваша оценка сохранена. Средняя оценка: ${aggregate.average} из 5 (${aggregate.count}).`, { reply_markup: back }); });

composer.callbackQuery(/^admin:photo:(approve|remove):(.+)$/, async (ctx) => { await answerCallbackSafely(ctx); if (!(await requireOwner(ctx as never))) return; const id = ctx.callbackQuery.data.slice(ctx.callbackQuery.data.indexOf(":", "admin:photo:".length) + 1); const status = ctx.callbackQuery.data.startsWith("admin:photo:approve:") ? "ok" : "removed"; ctx.session.profilePhotos = (ctx.session.profilePhotos ?? []).map((photo) => photo.photoId === id ? { ...photo, moderationStatus: status } : photo); await ctx.reply(status === "ok" ? "Фото одобрено." : "Фото скрыто."); });

export default composer;
