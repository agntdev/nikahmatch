import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, requireOwner } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

composer.command("admin_reports", async (ctx) => {
  if (!(await requireOwner(ctx as never))) return;
  const reports = ctx.session.reports ?? [];
  if (reports.length === 0) { await ctx.reply("Новых жалоб нет."); return; }
  await ctx.reply(`На проверку ждут жалобы: ${reports.length}.`, { reply_markup: inlineKeyboard([[inlineButton("Открыть жалобы", "admin:reports")]]) });
});

composer.command("admin_new", async (ctx) => {
  if (!(await requireOwner(ctx as never))) return;
  const profile = ctx.session.profile;
  await ctx.reply(profile ? `Последний профиль: ${String(profile.displayName)}.` : "Новых профилей для проверки нет.");
});

composer.callbackQuery("admin:reports", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as never))) return;
  const report = ctx.session.reports?.find((item) => item.status === "open");
  if (!report) { await ctx.reply("Открытых жалоб для проверки нет."); return; }
  await ctx.reply(`Причина жалобы: ${String(report.reason)}.`, { reply_markup: inlineKeyboard([[inlineButton("Удалить профиль", `admin:remove:${String(report.targetId)}`), inlineButton("Отклонить", `admin:dismiss:${String(report.id)}`)]]) });
});

composer.callbackQuery(/^admin:(remove|dismiss):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as never))) return;
  const [, action, id] = ctx.callbackQuery.data.split(":");
  if (action === "remove" && ctx.session.profile && String(ctx.session.profile.userId) === id) ctx.session.profile.deleted = true;
  for (const report of ctx.session.reports ?? []) report.status = action === "remove" ? "resolved" : "dismissed";
  await ctx.reply(action === "remove" ? "Профиль скрыт из поиска." : "Жалоба отклонена.");
});

composer.callbackQuery("admin:setup", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(adminChatId(ctx as never) ? "Доступ владельца настроен." : "Доступ владельца пока не настроен."); });

export default composer;
