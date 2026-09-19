import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { draftFromSession, now, notifyOwner, profileCard } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { isBlocked } from "./admin.js";

registerMainMenuItem({ label: "📝 Создать профиль", data: "profile:create", order: 10 });

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
  if (isBlocked(ctx)) { await ctx.reply("Ваш доступ к профилям приостановлен. Если это ошибка, обратитесь к команде сообщества."); return; }
  ctx.session.step = "profile_language";
  ctx.session.draft = {};
  await ctx.reply("Создадим профиль для серьёзного знакомства с намерением к никаху. Выберите язык:", {
    reply_markup: inlineKeyboard([[inlineButton("Русский", "profile:lang:ru"), inlineButton("English", "profile:lang:en")]]),
  });
});

composer.callbackQuery(/^profile:lang:(ru|en)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.language = ctx.callbackQuery.data.endsWith(":ru") ? "ru" : "en";
  ctx.session.step = "profile_consent";
  await ctx.reply("Здесь общаются уважительно и только с намерением к браку. Вам уже исполнилось 18 лет и вы согласны соблюдать эти правила?", {
    reply_markup: inlineKeyboard([[inlineButton("✅ Согласен(на)", "profile:consent:yes"), inlineButton("Не сейчас", "profile:consent:no")]]),
  });
});

composer.callbackQuery("profile:consent:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = undefined;
  await ctx.reply("Хорошо. Возвращайтесь, когда будете готовы.");
});

composer.callbackQuery("profile:consent:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  await askNext(ctx, "profile_name", "Как к вам обращаться в профиле?", "Ваше имя в профиле");
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  const draft = draftFromSession(ctx);
  switch (ctx.session.step) {
    case "profile_name":
      if (text.length < 2 || text.length > 60) { await ctx.reply("Введите имя длиной от 2 до 60 символов."); return; }
      draft.displayName = text;
      await askNext(ctx, "profile_age", "Сколько вам лет? Профиль доступен с 18 лет.", "Ваш возраст"); return;
    case "profile_age": {
      const age = Number(text);
      if (!Number.isInteger(age) || age < 18 || age > 100) { await ctx.reply("Профили доступны только совершеннолетним. Введите целое число от 18 до 100."); return; }
      draft.age = age;
      ctx.session.step = "profile_gender";
      await ctx.reply("Как вы себя описываете?", { reply_markup: inlineKeyboard([[inlineButton("Сестра", "profile:gender:woman"), inlineButton("Брат", "profile:gender:man")]]) }); return;
    }
    case "profile_city":
      if (text.length < 2) { await ctx.reply("Укажите город или регион, чтобы мы могли предложить знакомства рядом."); return; }
      draft.city = text;
      ctx.session.step = "profile_marital";
      await ctx.reply("Каков ваш семейный статус?", { reply_markup: inlineKeyboard([[inlineButton("Не был(а) в браке", "profile:marital:single"), inlineButton("Разведён(а)", "profile:marital:divorced"), inlineButton("Вдовец/вдова", "profile:marital:widowed")]]) }); return;
    case "profile_education":
      draft.education = text;
      return void (await askNext(ctx, "profile_occupation", "Где вы учитесь или работаете?", "Занятие или профессия"));
    case "profile_sect":
      draft.sect = text;
      ctx.session.step = "profile_practice";
      await ctx.reply("Как бы вы описали свою практику?", { reply_markup: inlineKeyboard([[inlineButton("В пути", "profile:practice:growing"), inlineButton("Практикую", "profile:practice:practising"), inlineButton("Строго соблюдаю", "profile:practice:devout")]]) }); return;
    case "profile_occupation":
      draft.occupation = text;
      return void (await askNext(ctx, "profile_bio", "Напишите несколько тёплых слов о себе и о том, кого надеетесь встретить.", "Короткое знакомство"));
    case "profile_bio":
      if (text.length < 10 || text.length > 500) { await ctx.reply("Текст должен быть длиной от 10 до 500 символов."); return; }
      draft.bio = text;
      ctx.session.step = "profile_photos";
      await ctx.reply("Предпросмотр готов. Фото необязательны и останутся скрытыми, пока вы не решите их показать.", { reply_markup: inlineKeyboard([[inlineButton("Пропустить фото", "profile:photos:skip")]]) }); return;
    default: return next();
  }
});

composer.callbackQuery(/^profile:gender:(woman|man)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).gender = ctx.callbackQuery.data.endsWith("woman") ? "woman" : "man";
  await ctx.reply("В каком городе или регионе вы живёте?", prompt("В каком городе или регионе вы живёте?", "Город или регион"));
  ctx.session.step = "profile_city";
});

composer.callbackQuery(/^profile:marital:(single|divorced|widowed)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).maritalStatus = ctx.callbackQuery.data.split(":").pop();
  ctx.session.step = "profile_sect";
  await ctx.reply("Следуете определённой школе или мазхабу? Это необязательно.", { reply_markup: inlineKeyboard([[inlineButton("Пропустить", "profile:sect:skip")]]) });
});

composer.callbackQuery("profile:sect:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "profile_practice";
  await ctx.reply("Как бы вы описали свою практику?", { reply_markup: inlineKeyboard([[inlineButton("В пути", "profile:practice:growing"), inlineButton("Практикую", "profile:practice:practising"), inlineButton("Строго соблюдаю", "profile:practice:devout")]]) });
});

composer.callbackQuery(/^profile:practice:(growing|practising|devout)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).practice = ctx.callbackQuery.data.split(":").pop();
  await askNext(ctx, "profile_education", "Какое у вас образование или направление учёбы?", "Образование");
});

composer.callbackQuery("profile:photos:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = draftFromSession(ctx);
  const required = ["displayName", "age", "gender", "city", "maritalStatus", "practice", "education", "occupation", "bio"];
    if (required.some((key) => (d as Record<string, unknown>)[key] === undefined)) { await ctx.reply("Не хватает одной детали. Нажмите «Создать профиль» и попробуйте ещё раз."); return; }
  ctx.session.step = "profile_confirm";
  await ctx.reply(`Вот как выглядит ваш профиль:\n\n${profileCard({ ...d, userId: ctx.from.id, hideName: true, hidePhotos: true, complete: false, createdAt: now(), updatedAt: now() } as never, ctx.from.id)}`, {
    reply_markup: inlineKeyboard([[inlineButton("✅ Подтвердить", "profile:confirm"), inlineButton("Изменить позже", "profile:create")]]),
  });
});

composer.callbackQuery("profile:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = draftFromSession(ctx);
  const timestamp = now();
  ctx.session.profile = { ...d, userId: ctx.from.id, hideName: true, hidePhotos: true, visible: true, complete: true, moderationStatus: "pending", createdAt: timestamp, updatedAt: timestamp };
  ctx.session.draft = undefined;
  ctx.session.step = undefined;
  const notified = await notifyOwner(ctx, `Новый профиль: ${String(d.displayName)} (${String(d.age)}), ${String(d.city)}.`);
  await ctx.reply(notified ? "Профиль опубликован. Команда сообщества получила уведомление." : "Профиль сохранён и опубликован. Уведомления владельцу пока не настроены.");
});

composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.step !== "profile_photos") return next();
  const photos = ((ctx.session.draft?.photos as string[] | undefined) ?? []);
  const largest = ctx.message.photo.at(-1);
  if (largest) photos.push(largest.file_id);
  ctx.session.draft = { ...(ctx.session.draft ?? {}), photos, hidePhotos: true };
  await ctx.reply("Фото пока сохранено приватно. Добавьте ещё одно или нажмите «Пропустить фото».", { reply_markup: inlineKeyboard([[inlineButton("Пропустить фото", "profile:photos:skip")]]) });
});

export default composer;
