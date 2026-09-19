import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { profileFromSession, profileCard } from "../domain.js";
import { isBlocked } from "./admin.js";

registerMainMenuItem({ label: "🔎 Найти знакомство", data: "browse:start", order: 20 });
const composer = new Composer<Ctx>();

function actions(target: number) {
  return inlineKeyboard([
    [inlineButton("❤️ Нравится", `browse:like:${target}`), inlineButton("Дальше", `browse:next:${target}`)],
    [inlineButton("Открыть профиль", `browse:view:${target}`), inlineButton("Пожаловаться", `profile:report:${target}`)],
    [inlineButton("⬅️ В меню", "menu:main")],
  ]);
}

composer.callbackQuery("browse:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (isBlocked(ctx)) { await ctx.reply("Ваш доступ к поиску приостановлен. Если это ошибка, обратитесь к команде сообщества."); return; }
  const own = profileFromSession(ctx);
  if (!own?.complete) {
    await ctx.reply("Сначала заполните профиль — после этого здесь появятся подходящие знакомства.", { reply_markup: inlineKeyboard([[inlineButton("📝 Создать профиль", "profile:create")]]) });
    return;
  }
  await ctx.reply("Пока нет знакомств по вашим фильтрам. Попробуйте изменить их или загляните позже.", { reply_markup: inlineKeyboard([[inlineButton("Изменить фильтры", "browse:filters")], [inlineButton("⬅️ В меню", "menu:main")]]) });
});

composer.callbackQuery(/^browse:(like|next|view):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, action, raw] = ctx.callbackQuery.data.split(":");
  const target = String(raw);
  const list = ctx.session[action === "like" ? "liked" : action === "next" ? "skipped" : "viewed"] ?? [];
  if (!list.includes(target)) list.push(target);
  if (action === "like") await ctx.reply("Отметка сохранена. Если симпатия взаимна, мы сообщим вам обоим.");
  else if (action === "view") {
    const own = profileFromSession(ctx);
    const purpose = own && String(own.userId) === target && (own.fundraisingPurposeText ?? own.fundraising_purpose_text);
    await ctx.reply(purpose ? `🎯 Цель: ${purpose.slice(0, 80)}${purpose.length > 80 ? "…" : ""}\n\nЛичные данные профиля защищены, пока вы оба не дадите согласие.` : "Личные данные профиля защищены, пока вы оба не дадите согласие.");
  }
  else await ctx.reply("Хорошо, ищем дальше.");
});

export default composer;
