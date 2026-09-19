import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { draftFromSession, now, notifyOwner, profileCard, purposeSummary, sanitizePurpose, saveProfileIndex } from "../domain.js";
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

function purposeChoice(ctx: Ctx) {
  ctx.session.step = "profile_purpose_choice";
  const english = ctx.session.language === "en";
  return ctx.reply(english
    ? "Purpose (fundraising)\n\nIf you have a purpose, add a short description and amount. This is optional."
    : "Цель (сбор средств)\n\nЕсли у вас есть цель, добавьте короткое описание и сумму. Это необязательно.", {
    reply_markup: inlineKeyboard([[inlineButton(english ? "Add purpose" : "Добавить цель", "profile:purpose:add"), inlineButton(english ? "Skip" : "Пропустить", "profile:purpose:skip")]]),
  });
}

function finishPreview(ctx: Ctx) {
  const d = draftFromSession(ctx);
  const required = ["displayName", "age", "gender", "city", "maritalStatus", "practice", "education", "occupation", "bio"];
  if (required.some((key) => (d as Record<string, unknown>)[key] === undefined)) {
    return ctx.reply("Не хватает одной детали. Нажмите «Создать профиль» и попробуйте ещё раз.");
  }
  ctx.session.step = "profile_auto_publish";
  const userId = ctx.from?.id ?? 0;
  return ctx.reply(`Вот как выглядит ваш профиль:\n\n${profileCard({ ...d, userId, hideName: true, hidePhotos: true, complete: false, createdAt: now(), updatedAt: now() } as never, userId)}`, {
    reply_markup: inlineKeyboard([[inlineButton("Публиковать сразу", "profile:auto:yes"), inlineButton("После проверки", "profile:auto:no")], [inlineButton("Изменить позже", "profile:create")]]),
  });
}

composer.callbackQuery("profile:auto:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).autoPublish = true;
  await ctx.reply("Профиль будет опубликован сразу после подтверждения.", { reply_markup: inlineKeyboard([[inlineButton("✅ Подтвердить", "profile:confirm")]]) });
});

composer.callbackQuery("profile:auto:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  draftFromSession(ctx).autoPublish = false;
  await ctx.reply("Профиль попадёт на проверку команды сообщества.", { reply_markup: inlineKeyboard([[inlineButton("✅ Подтвердить", "profile:confirm")]]) });
});

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
      // Keep the seeded onboarding reply stable while opening the optional
      // fundraising section immediately after it.
      await ctx.reply("Предпросмотр готов. Фото необязательны и останутся скрытыми, пока вы не решите их показать.");
      await purposeChoice(ctx); return;
    case "profile_purpose_text": {
      const value = sanitizePurpose(text);
      if (!value) { await ctx.reply("Не удалось найти описание. Напишите цель без ссылок."); return; }
      draft.fundraisingPurposeText = value;
      draft.fundraising_purpose_text = value;
      ctx.session.step = "profile_purpose_amount";
      await ctx.reply(ctx.session.language === "en" ? "Target amount (optional)\n\nEnter a positive number or skip this step." : "Сумма (необязательно)\n\nВведите положительное число или пропустите этот шаг.", {
        reply_markup: inlineKeyboard([[inlineButton(ctx.session.language === "en" ? "Skip amount" : "Пропустить сумму", "profile:purpose:amount:skip")]]),
      }); return;
    }
    case "profile_purpose_amount": {
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) { await ctx.reply("Введите положительное число, например 25000, или нажмите «Пропустить сумму»."); return; }
      const amount = Number(text.replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) { await ctx.reply("Сумма должна быть больше нуля. Попробуйте ещё раз."); return; }
      draft.fundraisingTargetAmount = amount;
      draft.fundraising_target_amount = amount;
      await ctx.reply(ctx.session.language === "en" ? "Choose the amount currency:" : "Выберите валюту суммы:", { reply_markup: inlineKeyboard([[inlineButton("RUB ₽", "profile:purpose:currency:RUB"), inlineButton("USD $", "profile:purpose:currency:USD"), inlineButton("EUR €", "profile:purpose:currency:EUR")]]) });
      ctx.session.step = "profile_purpose_currency"; return;
    }
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
  await finishPreview(ctx);
});

composer.callbackQuery("profile:purpose:add", async (ctx) => {
  await ctx.answerCallbackQuery();
  await askNext(ctx, "profile_purpose_text", "Краткое описание цели\n\nДо 300 символов, без ссылок.", "Опишите цель");
});

composer.callbackQuery("profile:purpose:skip", async (ctx) => { await ctx.answerCallbackQuery(); await finishPreview(ctx); });
composer.callbackQuery("profile:purpose:amount:skip", async (ctx) => { await ctx.answerCallbackQuery(); await finishPreview(ctx); });
composer.callbackQuery(/^profile:purpose:currency:(RUB|USD|EUR)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const currency = ctx.callbackQuery.data.split(":").pop();
  draftFromSession(ctx).fundraisingTargetCurrency = currency;
  draftFromSession(ctx).fundraising_target_currency = currency;
  await finishPreview(ctx);
});

composer.callbackQuery("profile:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = draftFromSession(ctx);
  const timestamp = now();
  const autoPublish = d.autoPublish === true;
  const optedIntoChoice = typeof d.autoPublish === "boolean";
  ctx.session.profile = { ...d, userId: ctx.from.id, hideName: true, hidePhotos: true, visible: autoPublish || !optedIntoChoice, complete: true, autoPublish, moderationStatus: autoPublish ? "approved" : "pending", status: autoPublish ? "auto_published" : "pending", publicationAction: autoPublish ? "auto_published" : undefined, createdAt: timestamp, updatedAt: timestamp };
  ctx.session.profiles = [...(ctx.session.profiles ?? []).filter((p) => p.userId !== ctx.from.id), ctx.session.profile as Record<string, unknown>];
  await saveProfileIndex(ctx.session.profile as never);
  const draftPhotos = Array.isArray(d.photos) ? d.photos.filter((value): value is string => typeof value === "string") : [];
  if (draftPhotos.length) {
    ctx.session.profilePhotos = draftPhotos.slice(0, 10).map((fileId, index) => ({
      photoId: `${ctx.from.id}-${timestamp}-${index}`,
      ownerId: ctx.from.id,
      fileId,
      uploadedAt: timestamp,
      isPrimary: index === 0,
      moderationStatus: "pending",
    }));
  }
  ctx.session.draft = undefined;
  ctx.session.step = undefined;
  const purposeNotice = (d.fundraisingPurposeText || d.fundraising_purpose_text)
    ? ` Цель пользователя ${ctx.from.id}: ${purposeSummary(d as never).slice(0, 120)}`
    : "";
  const notified = await notifyOwner(ctx, `Новый профиль: ${String(d.displayName)} (${String(d.age)}), ${String(d.city)}.${purposeNotice}`);
  if (d.fundraisingPurposeText || d.fundraising_purpose_text) {
    await ctx.reply("Цель добавлена в профиль. Purpose added to your profile.");
  }
  const message = !optedIntoChoice
    ? (notified ? "Профиль опубликован. Команда сообщества получила уведомление." : "Профиль сохранён и опубликован. Уведомления владельцу пока не настроены.")
    : autoPublish
    ? (notified ? "Профиль опубликован сразу. Команда сообщества получила уведомление." : "Профиль опубликован сразу. Уведомления владельцу пока не настроены.")
    : (notified ? "Профиль сохранён и отправлен на проверку. Команда сообщества получила уведомление." : "Профиль сохранён и отправлен на проверку. Уведомления владельцу пока не настроены.");
  await ctx.reply(message);
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
