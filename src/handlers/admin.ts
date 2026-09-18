import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, requireOwner } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

composer.command("admin_reports", async (ctx) => {
  if (!(await requireOwner(ctx as never))) return;
  const reports = ctx.session.reports ?? [];
  if (reports.length === 0) { await ctx.reply("There are no reports waiting for review."); return; }
  await ctx.reply(`There are ${reports.length} report${reports.length === 1 ? "" : "s"} waiting for review.`, { reply_markup: inlineKeyboard([[inlineButton("Review reports", "admin:reports")]]) });
});

composer.command("admin_new", async (ctx) => {
  if (!(await requireOwner(ctx as never))) return;
  const profile = ctx.session.profile;
  await ctx.reply(profile ? `The newest profile is ${String(profile.displayName)}.` : "There are no new profiles to review.");
});

composer.callbackQuery("admin:reports", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as never))) return;
  const report = ctx.session.reports?.find((item) => item.status === "open");
  if (!report) { await ctx.reply("There are no open reports to review."); return; }
  await ctx.reply(`Report reason: ${String(report.reason)}.`, { reply_markup: inlineKeyboard([[inlineButton("Remove profile", `admin:remove:${String(report.targetId)}`), inlineButton("Dismiss", `admin:dismiss:${String(report.id)}`)]]) });
});

composer.callbackQuery(/^admin:(remove|dismiss):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as never))) return;
  const [, action, id] = ctx.callbackQuery.data.split(":");
  if (action === "remove" && ctx.session.profile && String(ctx.session.profile.userId) === id) ctx.session.profile.deleted = true;
  for (const report of ctx.session.reports ?? []) report.status = action === "remove" ? "resolved" : "dismissed";
  await ctx.reply(action === "remove" ? "The profile was removed from browsing." : "The report was dismissed.");
});

composer.callbackQuery("admin:setup", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(adminChatId(ctx as never) ? "Owner access is ready." : "Owner access isn’t set up yet."); });

export default composer;
