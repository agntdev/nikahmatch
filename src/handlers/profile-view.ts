import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { now, notifyOwner, profileFromSession, purposeSummary, sanitizePurpose } from "../domain.js";

registerMainMenuItem({ label: "👤 Мой профиль", data: "profile:view", order: 30 });
const composer = new Composer<Ctx>();

function profileText(p: ReturnType<typeof profileFromSession>): string {
  if (!p) return "";
  const purpose = p.fundraisingPurposeText ?? p.fundraising_purpose_text;
  const amount = p.fundraisingTargetAmount ?? p.fundraising_target_amount;
  const currency = p.fundraisingTargetCurrency ?? p.fundraising_target_currency;
  const fundraising = purpose
    ? `\n\nЦель (сбор средств):\n${purpose}${amount !== undefined && currency ? `\nСумма: ${amount} ${currency}` : ""}`
    : "";
  return `Ваш профиль\n\n${p.displayName}, ${p.age} · ${p.city}\n${p.bio}${fundraising}`;
}

function editKeyboard() {
  return inlineKeyboard([
    [inlineButton("Цель (сбор средств)", "profile:edit:purpose")],
    [inlineButton("Изменить имя", "profile:edit:name"), inlineButton("Изменить описание", "profile:edit:bio")],
    [inlineButton("Автопубликация", "profile:edit:auto")],
    [inlineButton("⬅️ К профилю", "profile:view")],
  ]);
}

composer.callbackQuery("profile:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = profileFromSession(ctx);
  if (!p) { await ctx.reply("Вы ещё не создали профиль. Это займёт всего несколько минут.", { reply_markup: inlineKeyboard([[inlineButton("📝 Создать профиль", "profile:create")]]) }); return; }
  await ctx.reply(profileText(p), { reply_markup: inlineKeyboard([
    [inlineButton("📰 Лента", "feed:open")],
    [inlineButton("Мои чаты", "profile:chats"), inlineButton("Избранные", "profile:favorites")],
    [inlineButton("Чёрный список", "profile:blacklist"), inlineButton("Гости", "profile:visitors")],
    [inlineButton("Фотографии и оценки", "profile:photos")],
    [inlineButton("Уведомления", "profile:notifications")],
    [inlineButton("Изменить профиль", "profile:edit")],
    [inlineButton(p.hideName ? "Показать имя" : "Скрыть имя", "privacy:name")],
    [inlineButton(p.hidePhotos ? "Показать фото" : "Скрыть фото", "privacy:photos")],
    [inlineButton("Удалить аккаунт", "profile:delete")],
    [inlineButton("⬅️ В меню", "menu:main")],
  ]) });
});

composer.callbackQuery("profile:edit", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!profileFromSession(ctx)) { await ctx.reply("Сначала создайте профиль."); return; }
  await ctx.reply("Что хотите изменить?", { reply_markup: editKeyboard() });
});

composer.callbackQuery("profile:edit:auto", async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = profileFromSession(ctx);
  if (!p) { await ctx.reply("Сначала создайте профиль."); return; }
  p.autoPublish = p.autoPublish !== true;
  p.visible = p.autoPublish;
  p.moderationStatus = p.autoPublish ? "approved" : "pending";
  p.status = p.autoPublish ? "auto_published" : "pending";
  p.publicationAction = p.autoPublish ? "auto_published" : undefined;
  p.updatedAt = now();
  await ctx.reply(p.autoPublish ? "Автопубликация включена — профиль виден сразу." : "Автопубликация выключена — профиль будет проверяться командой.", { reply_markup: editKeyboard() });
});

composer.callbackQuery("profile:edit:purpose", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!profileFromSession(ctx)) { await ctx.reply("Сначала создайте профиль."); return; }
  ctx.session.step = "profile_edit_purpose_text";
  await ctx.reply("Краткое описание цели\n\nДо 300 символов, без ссылок. Чтобы убрать цель, нажмите кнопку ниже.", {
    reply_markup: inlineKeyboard([[inlineButton("Очистить цель", "profile:purpose:clear")], [inlineButton("⬅️ К профилю", "profile:view")]]),
  });
});

composer.callbackQuery("profile:purpose:clear", async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = profileFromSession(ctx);
  if (p) {
    delete p.fundraisingPurposeText; delete p.fundraising_purpose_text;
    delete p.fundraisingTargetAmount; delete p.fundraising_target_amount;
    delete p.fundraisingTargetCurrency; delete p.fundraising_target_currency;
    p.updatedAt = now();
  }
  await notifyOwner(ctx, `Пользователь ${ctx.from?.id ?? ""} обновил цель: поле очищено.`);
  await ctx.reply("Цель удалена из профиля. Purpose removed from your profile.");
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "profile_edit_purpose_text") return next();
  const value = sanitizePurpose(ctx.message.text);
  if (!value) { await ctx.reply("Не удалось найти описание. Напишите цель без ссылок."); return; }
  const p = profileFromSession(ctx);
  if (!p) { ctx.session.step = undefined; await ctx.reply("Сначала создайте профиль."); return; }
  p.fundraisingPurposeText = value; p.fundraising_purpose_text = value;
  ctx.session.step = "profile_edit_purpose_amount";
  await ctx.reply("Сумма (необязательно)\n\nВведите положительное число или пропустите этот шаг.", { reply_markup: inlineKeyboard([[inlineButton("Пропустить сумму", "profile:edit:purpose:amount:skip")]]) });
});

composer.callbackQuery("profile:edit:purpose:amount:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = profileFromSession(ctx); if (p) { delete p.fundraisingTargetAmount; delete p.fundraising_target_amount; delete p.fundraisingTargetCurrency; delete p.fundraising_target_currency; p.updatedAt = now(); }
  ctx.session.step = undefined;
  if (p) await notifyOwner(ctx, `Пользователь ${ctx.from?.id ?? ""} обновил цель: ${purposeSummary(p).slice(0, 120)}`);
  await ctx.reply("Цель обновлена. Purpose updated.");
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "profile_edit_purpose_amount") return next();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(ctx.message.text.trim())) { await ctx.reply("Введите положительное число или нажмите «Пропустить сумму»."); return; }
  const amount = Number(ctx.message.text.trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) { await ctx.reply("Сумма должна быть больше нуля. Попробуйте ещё раз."); return; }
  const p = profileFromSession(ctx); if (!p) { ctx.session.step = undefined; await ctx.reply("Сначала создайте профиль."); return; }
  p.fundraisingTargetAmount = amount; p.fundraising_target_amount = amount;
  ctx.session.step = "profile_edit_purpose_currency";
  await ctx.reply("Выберите валюту суммы:", { reply_markup: inlineKeyboard([[inlineButton("RUB ₽", "profile:edit:purpose:currency:RUB"), inlineButton("USD $", "profile:edit:purpose:currency:USD"), inlineButton("EUR €", "profile:edit:purpose:currency:EUR")]]) });
});

composer.callbackQuery(/^profile:edit:purpose:currency:(RUB|USD|EUR)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = profileFromSession(ctx); const currency = ctx.callbackQuery.data.split(":").pop();
  if (p) { p.fundraisingTargetCurrency = currency; p.fundraising_target_currency = currency; p.updatedAt = now(); }
  ctx.session.step = undefined;
  if (p) await notifyOwner(ctx, `Пользователь ${ctx.from?.id ?? ""} обновил цель: ${purposeSummary(p).slice(0, 120)}`);
  await ctx.reply("Цель обновлена. Purpose updated.");
});

composer.callbackQuery("privacy:name", async (ctx) => { await ctx.answerCallbackQuery(); const p = profileFromSession(ctx); if (p) p.hideName = !p.hideName; await ctx.reply(p?.hideName ? "Ваше имя скрыто." : "Ваше имя видно другим заполненным профилям."); });
composer.callbackQuery("privacy:photos", async (ctx) => { await ctx.answerCallbackQuery(); const p = profileFromSession(ctx); if (p) p.hidePhotos = !p.hidePhotos; await ctx.reply(p?.hidePhotos ? "Ваши фото скрыты." : "Ваши фото видны другим заполненным профилям."); });
composer.callbackQuery("profile:delete", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Удаление уберёт профиль, фото, совпадения и жалобы. Вернуть данные нельзя.", { reply_markup: inlineKeyboard([[inlineButton("Удалить всё", "profile:delete:yes"), inlineButton("Оставить профиль", "profile:delete:no")]]) }); });
composer.callbackQuery("profile:delete:no", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Профиль в безопасности — ничего не удалено."); });
composer.callbackQuery("profile:delete:yes", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.profile = undefined; ctx.session.draft = undefined; ctx.session.matches = undefined; ctx.session.reports = undefined; ctx.session.liked = undefined; ctx.session.favorites = undefined; ctx.session.blacklist = undefined; ctx.session.visitors = undefined; ctx.session.profilePhotos = undefined; ctx.session.photoRatings = undefined; await notifyOwner(ctx, `Участник удалил профиль (${ctx.from.id}).`); await ctx.reply("Профиль и связанные данные удалены. Возвращайтесь, когда будете готовы."); });

export default composer;
