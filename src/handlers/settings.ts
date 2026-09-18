import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { en, ru, text } from "../i18n.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "⚙️ Настройки", data: "settings:open", order: 60 });
const composer = new Composer<Ctx>();

composer.callbackQuery("settings:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(text(ctx, "Выберите язык интерфейса.", "Choose the interface language."), {
    reply_markup: inlineKeyboard([
      [inlineButton("Русский", "settings:lang:ru"), inlineButton("English", "settings:lang:en")],
      [inlineButton(text(ctx, ru.back, en.back), "menu:main")],
    ]),
  });
});

composer.callbackQuery("settings:lang:ru", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.language = "ru";
  await ctx.reply("Язык сохранён: русский.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]) });
});

composer.callbackQuery("settings:lang:en", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.language = "en";
  await ctx.reply("Language saved: English.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) });
});

export default composer;
