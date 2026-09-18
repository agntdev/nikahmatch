import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { en, ru, text } from "../i18n.js";

// /help — plain-language explanation for non-technical users. This bot is
// button-driven: tell the user to tap /start to open the menu rather than listing
// slash commands. The same text is shown when the user taps the Help button on the
// main menu (`menu:help`). Enhance the copy for your specific bot; keep it short.
const composer = new Composer<Ctx>();

composer.command("help", async (ctx) => {
  await ctx.reply(text(ctx, ru.help, en.help));
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text(ctx, ru.help, en.help), { reply_markup: inlineKeyboard([[inlineButton(text(ctx, ru.back, en.back), "menu:main")]]) });
});

export default composer;
