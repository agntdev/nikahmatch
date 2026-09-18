import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { notifyOwner, profileFromSession } from "../domain.js";

registerMainMenuItem({ label: "👤 My profile", data: "profile:view", order: 30 });
const composer = new Composer<Ctx>();

composer.callbackQuery("profile:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const p = profileFromSession(ctx);
  if (!p) { await ctx.reply("You haven’t created a profile yet. It only takes a few minutes.", { reply_markup: inlineKeyboard([[inlineButton("📝 Create profile", "profile:create")]]) }); return; }
  await ctx.reply(`Your profile\n\n${p.displayName}, ${p.age} · ${p.city}\n${p.bio}`, { reply_markup: inlineKeyboard([
    [inlineButton(p.hideName ? "Show my name" : "Hide my name", "privacy:name")],
    [inlineButton(p.hidePhotos ? "Show my photos" : "Hide my photos", "privacy:photos")],
    [inlineButton("Delete my account", "profile:delete")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]) });
});

composer.callbackQuery("privacy:name", async (ctx) => { await ctx.answerCallbackQuery(); const p = profileFromSession(ctx); if (p) p.hideName = !p.hideName; await ctx.reply(p?.hideName ? "Your name is hidden now." : "Your name is visible to complete profiles now."); });
composer.callbackQuery("privacy:photos", async (ctx) => { await ctx.answerCallbackQuery(); const p = profileFromSession(ctx); if (p) p.hidePhotos = !p.hidePhotos; await ctx.reply(p?.hidePhotos ? "Your photos are hidden now." : "Your photos are visible to complete profiles now."); });
composer.callbackQuery("profile:delete", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Deleting your account removes your profile, photos, matches, and reports. This can’t be undone.", { reply_markup: inlineKeyboard([[inlineButton("Delete everything", "profile:delete:yes"), inlineButton("Keep my profile", "profile:delete:no")]]) }); });
composer.callbackQuery("profile:delete:no", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Your profile is safe — nothing was deleted."); });
composer.callbackQuery("profile:delete:yes", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.profile = undefined; ctx.session.draft = undefined; ctx.session.matches = undefined; ctx.session.reports = undefined; ctx.session.liked = undefined; await notifyOwner(ctx, `A member deleted their profile (${ctx.from.id}).`); await ctx.reply("Your profile and related data have been deleted. You’re always welcome back."); });

export default composer;
