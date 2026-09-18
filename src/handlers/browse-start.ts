import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { profileFromSession, profileCard } from "../domain.js";

registerMainMenuItem({ label: "🔎 Browse profiles", data: "browse:start", order: 20 });
const composer = new Composer<Ctx>();

function actions(target: number) {
  return inlineKeyboard([
    [inlineButton("❤️ Like", `browse:like:${target}`), inlineButton("Next", `browse:next:${target}`)],
    [inlineButton("View profile", `browse:view:${target}`), inlineButton("Report", `profile:report:${target}`)],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("browse:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = profileFromSession(ctx);
  if (!own?.complete) {
    await ctx.reply("Complete your profile first, then you’ll see thoughtful introductions here.", { reply_markup: inlineKeyboard([[inlineButton("📝 Create profile", "profile:create")]]) });
    return;
  }
  await ctx.reply("There aren’t any introductions matching your filters yet. Check back soon, or update your filters.", { reply_markup: inlineKeyboard([[inlineButton("Set filters", "browse:filters")], [inlineButton("⬅️ Back to menu", "menu:main")]]) });
});

composer.callbackQuery(/^browse:(like|next|view):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, action, raw] = ctx.callbackQuery.data.split(":");
  const target = String(raw);
  const list = ctx.session[action === "like" ? "liked" : action === "next" ? "skipped" : "viewed"] ?? [];
  if (!list.includes(target)) list.push(target);
  if (action === "like") await ctx.reply("Like saved. If they like you too, I’ll let you both know.");
  else if (action === "view") await ctx.reply("This profile’s private details stay protected until you both consent.");
  else await ctx.reply("Got it — we’ll keep looking.");
});

export default composer;
