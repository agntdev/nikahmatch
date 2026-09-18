import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { draftFromSession, now, notifyOwner, profileCard } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "📝 Create profile", data: "profile:create", order: 10 });

const composer = new Composer<Ctx>();
const prompt = (text: string, placeholder: string) => ({
  reply_markup: { force_reply: true as const, input_field_placeholder: placeholder },
});

function askNext(ctx: Ctx, step: string, text: string, placeholder: string) {
  ctx.session.step = step;
  return ctx.reply(text, prompt(text, placeholder));
}

composer.callbackQuery("profile:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "profile_language";
  ctx.session.draft = {};
  await ctx.reply("Let’s create a marriage-focused profile. Choose your language:", {
    reply_markup: inlineKeyboard([[inlineButton("Русский", "profile:lang:ru"), inlineButton("English", "profile:lang:en")]]),
  });
});

composer.callbackQuery(/^profile:lang:(ru|en)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.language = ctx.callbackQuery.data.endsWith(":ru") ? "ru" : "en";
  ctx.session.step = "profile_consent";
  await ctx.reply("This space is for respectful, marriage-focused introductions. Are you 18 or older and happy to follow those rules?", {
    reply_markup: inlineKeyboard([[inlineButton("✅ I agree", "profile:consent:yes"), inlineButton("Not now", "profile:consent:no")]]),
  });
});

composer.callbackQuery("profile:consent:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = undefined;
  await ctx.reply("That’s okay. You can return whenever you’re ready.");
});

composer.callbackQuery("profile:consent:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  await askNext(ctx, "profile_name", "What name should other members see?", "Your display name");
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  const draft = draftFromSession(ctx);
  switch (ctx.session.step) {
    case "profile_name":
      if (text.length < 2 || text.length > 60) { await ctx.reply("Use a name between 2 and 60 characters."); return; }
      draft.displayName = text;
      await askNext(ctx, "profile_age", "How old are you? You must be 18 or older.", "Your age"); return;
    case "profile_age": {
      const age = Number(text);
      if (!Number.isInteger(age) || age < 18 || age > 100) { await ctx.reply("Profiles are for adults 18 and over. Enter a whole number from 18 to 100."); return; }
      draft.age = age;
      ctx.session.step = "profile_gender";
      await ctx.reply("How do you describe yourself?", { reply_markup: inlineKeyboard([[inlineButton("Sister", "profile:gender:woman"), inlineButton("Brother", "profile:gender:man")]]) }); return;
    }
    case "profile_city":
      if (text.length < 2) { await ctx.reply("Tell us your city or region so we can suggest nearby introductions."); return; }
      draft.city = text;
      ctx.session.step = "profile_marital";
      await ctx.reply("What’s your marital status?", { reply_markup: inlineKeyboard([[inlineButton("Never married", "profile:marital:single"), inlineButton("Divorced", "profile:marital:divorced"), inlineButton("Widowed", "profile:marital:widowed")]]) }); return;
    case "profile_education":
      draft.education = text;
      return void (await askNext(ctx, "profile_occupation", "What do you do for work or study?", "Your occupation"));
    case "profile_sect":
      draft.sect = text;
      ctx.session.step = "profile_practice";
      await ctx.reply("How would you describe your practice?", { reply_markup: inlineKeyboard([[inlineButton("Growing", "profile:practice:growing"), inlineButton("Practising", "profile:practice:practising"), inlineButton("Very practising", "profile:practice:devout")]]) }); return;
    case "profile_occupation":
      draft.occupation = text;
      return void (await askNext(ctx, "profile_bio", "Write a few warm words about yourself and what you hope to find.", "A short introduction"));
    case "profile_bio":
      if (text.length < 10 || text.length > 500) { await ctx.reply("Keep your introduction between 10 and 500 characters."); return; }
      draft.bio = text;
      ctx.session.step = "profile_photos";
      await ctx.reply("Your preview is ready. Photos are optional and stay hidden until you choose to show them.", { reply_markup: inlineKeyboard([[inlineButton("Skip photos", "profile:photos:skip")]]) }); return;
    default: return next();
  }
});

composer.callbackQuery(/^profile:gender:(woman|man)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).gender = ctx.callbackQuery.data.endsWith("woman") ? "woman" : "man";
  await ctx.reply("Which city or region are you in?", prompt("Which city or region are you in?", "City or region"));
  ctx.session.step = "profile_city";
});

composer.callbackQuery(/^profile:marital:(single|divorced|widowed)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).maritalStatus = ctx.callbackQuery.data.split(":").pop();
  ctx.session.step = "profile_sect";
  await ctx.reply("Do you follow a particular school or sect? This is optional.", { reply_markup: inlineKeyboard([[inlineButton("Skip", "profile:sect:skip")]]) });
});

composer.callbackQuery("profile:sect:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "profile_practice";
  await ctx.reply("How would you describe your practice?", { reply_markup: inlineKeyboard([[inlineButton("Growing", "profile:practice:growing"), inlineButton("Practising", "profile:practice:practising"), inlineButton("Very practising", "profile:practice:devout")]]) });
});

composer.callbackQuery(/^profile:practice:(growing|practising|devout)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).practice = ctx.callbackQuery.data.split(":").pop();
  await askNext(ctx, "profile_education", "What’s your education or field of study?", "Education");
});

composer.callbackQuery("profile:photos:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = draftFromSession(ctx);
  const required = ["displayName", "age", "gender", "city", "maritalStatus", "practice", "education", "occupation", "bio"];
  if (required.some((key) => (d as Record<string, unknown>)[key] === undefined)) { await ctx.reply("A detail is still missing. Tap Create profile to try again."); return; }
  ctx.session.step = "profile_confirm";
  await ctx.reply(`Here’s your profile preview:\n\n${profileCard({ ...d, userId: ctx.from.id, hideName: true, hidePhotos: true, complete: false, createdAt: now(), updatedAt: now() } as never, ctx.from.id)}`, {
    reply_markup: inlineKeyboard([[inlineButton("✅ Confirm profile", "profile:confirm"), inlineButton("Edit later", "profile:create")]]),
  });
});

composer.callbackQuery("profile:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = draftFromSession(ctx);
  const timestamp = now();
  ctx.session.profile = { ...d, userId: ctx.from.id, hideName: true, hidePhotos: true, complete: true, createdAt: timestamp, updatedAt: timestamp };
  ctx.session.draft = undefined;
  ctx.session.step = undefined;
  const notified = await notifyOwner(ctx, `New profile submitted: ${String(d.displayName)} (${String(d.age)}) in ${String(d.city)}.`);
  await ctx.reply(notified ? "Your profile is live. The community team has been notified." : "Your profile is saved and live. Owner notifications aren’t set up yet.");
});

composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.step !== "profile_photos") return next();
  const photos = ((ctx.session.draft?.photos as string[] | undefined) ?? []);
  const largest = ctx.message.photo.at(-1);
  if (largest) photos.push(largest.file_id);
  ctx.session.draft = { ...(ctx.session.draft ?? {}), photos, hidePhotos: true };
  await ctx.reply("Photo saved privately for now. Add another, or tap Skip photos to continue.", { reply_markup: inlineKeyboard([[inlineButton("Skip photos", "profile:photos:skip")]]) });
});

export default composer;
