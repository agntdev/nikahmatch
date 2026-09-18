import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { now, notifyOwner } from "../domain.js";
import { notifyAdmins } from "./admin.js";

registerMainMenuItem({ label: "🛡️ Пожаловаться", data: "profile:report", order: 50 });
const composer = new Composer<Ctx>();

function reasonKeyboard(target: string) {
  return inlineKeyboard([
    [inlineButton("Небезопасно или нечестно", `report:reason:${target}:unsafe`)],
    [inlineButton("Недопустимый контент", `report:reason:${target}:content`)],
    [inlineButton("Другая причина", `report:reason:${target}:other`)],
  ]);
}

composer.callbackQuery("profile:report", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Жаль, что что-то пошло не так. Выберите причину — команда сообщества всё проверит.", { reply_markup: reasonKeyboard("0") }); });
composer.callbackQuery(/^profile:report:(-?\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Жаль, что что-то пошло не так. Выберите причину — команда сообщества всё проверит.", { reply_markup: reasonKeyboard(ctx.callbackQuery.data.split(":").pop() ?? "0") }); });

composer.callbackQuery(/^report:reason:(-?\d+):(unsafe|content|other)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, targetRaw, reason] = ctx.callbackQuery.data.split(":");
  const targetId = Number(targetRaw);
  const timestamp = now();
  const report = { id: `${ctx.from.id}-${targetId}-${timestamp}`, reporterId: ctx.from.id, targetId, reason, status: "open", createdAt: timestamp };
  ctx.session.reports = [...(ctx.session.reports ?? []), report];
  const notified = await notifyAdmins(ctx, `Новая жалоба требует проверки. Причина: ${reason}.`);
  await ctx.reply(notified ? "Спасибо, что рассказали. Команда сообщества проверит жалобу." : "Спасибо, что рассказали. Жалоба сохранена, но уведомления владельцу пока не настроены.");
});

export default composer;
