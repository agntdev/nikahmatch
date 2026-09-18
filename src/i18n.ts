import type { Ctx } from "./bot.js";

export type Locale = "ru" | "en";

/** Russian is the product default. Missing or legacy preferences intentionally fall back to it. */
export function locale(ctx: Ctx): Locale {
  return ctx.session.language === "en" ? "en" : "ru";
}

export function text(ctx: Ctx, ru: string, en: string): string {
  return locale(ctx) === "ru" ? ru : en;
}

export const ru = {
  back: "⬅️ В меню",
  help: "ℹ️ Нажмите /start, чтобы открыть меню, и выберите нужный раздел.\n\nВсё работает через кнопки — команды запоминать не нужно.",
  welcome: "👋 Добро пожаловать в «Никаḥ: знакомство». Выберите действие ниже.",
};

export const en = {
  back: "⬅️ Back to menu",
  help: "ℹ️ Tap /start to open the menu, then choose what you need.\n\nEverything works through buttons — there are no commands to remember.",
  welcome: "👋 Welcome to Nikaḥ Matchmaker. Choose an action below.",
};
