import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "⚙️ Фильтры", data: "browse:filters", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("browse:filters", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Выберите, с кем вы хотите познакомиться.", { reply_markup: inlineKeyboard([
    [inlineButton("Сёстры", "filter:gender:woman"), inlineButton("Братья", "filter:gender:man")],
    [inlineButton("18–30 лет", "filter:age:18-30"), inlineButton("31+ лет", "filter:age:31-100")],
    [inlineButton("Любой уровень практики", "filter:practice:any")],
  ]) });
});

composer.callbackQuery(/^filter:(gender|age|practice):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, key, value] = ctx.callbackQuery.data.split(":");
  ctx.session.filters = { ...(ctx.session.filters ?? {}), [key]: value };
  const f = ctx.session.filters;
  await ctx.reply(`Фильтры сохранены: ${f.gender ?? "любой пол"}, ${f.age ?? "любой возраст"}, ${f.practice ?? "любой уровень практики"}.`, { reply_markup: inlineKeyboard([[inlineButton("Начать поиск", "browse:start")], [inlineButton("⬅️ В меню", "menu:main")]]) });
});

export default composer;
