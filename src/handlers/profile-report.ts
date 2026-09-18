import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { now, notifyOwner } from "../domain.js";

registerMainMenuItem({ label: "🛡️ Report a profile", data: "profile:report", order: 50 });
const composer = new Composer<Ctx>();

function reasonKeyboard(target: string) {
  return inlineKeyboard([
    [inlineButton("Unsafe or dishonest", `report:reason:${target}:unsafe`)],
    [inlineButton("Inappropriate content", `report:reason:${target}:content`)],
    [inlineButton("Something else", `report:reason:${target}:other`)],
  ]);
}

composer.callbackQuery("profile:report", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("I’m sorry something felt wrong. Choose the closest reason so our community team can review it.", { reply_markup: reasonKeyboard("0") }); });
composer.callbackQuery(/^profile:report:(-?\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("I’m sorry something felt wrong. Choose the closest reason so our community team can review it.", { reply_markup: reasonKeyboard(ctx.callbackQuery.data.split(":").pop() ?? "0") }); });

composer.callbackQuery(/^report:reason:(-?\d+):(unsafe|content|other)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, targetRaw, reason] = ctx.callbackQuery.data.split(":");
  const targetId = Number(targetRaw);
  const timestamp = now();
  const report = { id: `${ctx.from.id}-${targetId}-${timestamp}`, reporterId: ctx.from.id, targetId, reason, status: "open", createdAt: timestamp };
  ctx.session.reports = [...(ctx.session.reports ?? []), report];
  const notified = await notifyOwner(ctx, `A profile report needs review. Reason: ${reason}.`);
  await ctx.reply(notified ? "Thanks for telling us. The community team will review this report." : "Thanks for telling us. Owner notifications aren’t set up yet, but your report is saved.");
});

export default composer;
