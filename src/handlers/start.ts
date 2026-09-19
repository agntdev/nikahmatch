import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, mainMenuItems } from "../toolkit/index.js";
import { en, ru, text } from "../i18n.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

function menu(ctx: Ctx) {
  const items = mainMenuItems().filter((item) => item.data !== "admin:open");
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2).map((item) => inlineButton(item.label, item.data)));
  rows.push([inlineButton("❓ Help", "menu:help")]);
  return inlineKeyboard(rows);
}

composer.command("start", async (ctx) => {
  await ctx.reply(text(ctx, ru.welcome, en.welcome), { reply_markup: menu(ctx) });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text(ctx, ru.welcome, en.welcome), { reply_markup: menu(ctx) });
});

export default composer;
