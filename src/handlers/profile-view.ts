import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { notifyOwner, profileFromSession } from "../domain.js";

registerMainMenuItem({ label: "👤 Мой профиль", data: "profile:view", order: 30 });
const composer = new Composer<Ctx>();

composer.callbackQuery("profile:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = profileFromSession(ctx);
  if (!p) { await ctx.reply("Вы ещё не создали профиль. Это займёт всего несколько минут.", { reply_markup: inlineKeyboard([[inlineButton("📝 Создать профиль", "profile:create")]]) }); return; }
  await ctx.reply(`Ваш профиль\n\n${p.displayName}, ${p.age} · ${p.city}\n${p.bio}`, { reply_markup: inlineKeyboard([
    [inlineButton(p.hideName ? "Показать имя" : "Скрыть имя", "privacy:name")],
    [inlineButton(p.hidePhotos ? "Показать фото" : "Скрыть фото", "privacy:photos")],
    [inlineButton("Удалить аккаунт", "profile:delete")],
    [inlineButton("⬅️ В меню", "menu:main")],
  ]) });
});

composer.callbackQuery("privacy:name", async (ctx) => { await ctx.answerCallbackQuery(); const p = profileFromSession(ctx); if (p) p.hideName = !p.hideName; await ctx.reply(p?.hideName ? "Ваше имя скрыто." : "Ваше имя видно другим заполненным профилям."); });
composer.callbackQuery("privacy:photos", async (ctx) => { await ctx.answerCallbackQuery(); const p = profileFromSession(ctx); if (p) p.hidePhotos = !p.hidePhotos; await ctx.reply(p?.hidePhotos ? "Ваши фото скрыты." : "Ваши фото видны другим заполненным профилям."); });
composer.callbackQuery("profile:delete", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Удаление уберёт профиль, фото, совпадения и жалобы. Вернуть данные нельзя.", { reply_markup: inlineKeyboard([[inlineButton("Удалить всё", "profile:delete:yes"), inlineButton("Оставить профиль", "profile:delete:no")]]) }); });
composer.callbackQuery("profile:delete:no", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Профиль в безопасности — ничего не удалено."); });
composer.callbackQuery("profile:delete:yes", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.profile = undefined; ctx.session.draft = undefined; ctx.session.matches = undefined; ctx.session.reports = undefined; ctx.session.liked = undefined; await notifyOwner(ctx, `Участник удалил профиль (${ctx.from.id}).`); await ctx.reply("Профиль и связанные данные удалены. Возвращайтесь, когда будете готовы."); });

export default composer;
