import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "⚙️ Filters", data: "browse:filters", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("browse:filters", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Choose the kind of introduction you’d like to see.", { reply_markup: inlineKeyboard([
    [inlineButton("Sisters", "filter:gender:woman"), inlineButton("Brothers", "filter:gender:man")],
    [inlineButton("Adults 18–30", "filter:age:18-30"), inlineButton("Adults 31+", "filter:age:31-100")],
    [inlineButton("Any practice level", "filter:practice:any")],
  ]) });
});

composer.callbackQuery(/^filter:(gender|age|practice):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, key, value] = ctx.callbackQuery.data.split(":");
  ctx.session.filters = { ...(ctx.session.filters ?? {}), [key]: value };
  const f = ctx.session.filters;
  await ctx.reply(`Your filters are saved: ${f.gender ?? "any gender"}, ${f.age ?? "any age"}, ${f.practice ?? "any practice level"}.`, { reply_markup: inlineKeyboard([[inlineButton("Browse now", "browse:start")], [inlineButton("⬅️ Back to menu", "menu:main")]]) });
});

export default composer;
