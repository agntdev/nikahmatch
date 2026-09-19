import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { editTextOrReply, now, notifyOwner, profileFromSession } from "../domain.js";
import { inlineButton, inlineKeyboard, mainMenuItems, registerMainMenuItem } from "../toolkit/index.js";

// Russian users can always find their profile from the top-level menu.
registerMainMenuItem({ label: "Меню", data: "menu:open", order: 0 });

const composer = new Composer<Ctx>();

function menuKeyboard() {
  const existing = mainMenuItems()
    .filter((item) => item.data !== "menu:open" && item.data !== "profile:view")
    .map((item) => inlineButton(item.label, item.data));
  return inlineKeyboard([
    [inlineButton("Моя анкета", "menu:profile")],
    ...Array.from({ length: Math.ceil(existing.length / 2) }, (_, index) => existing.slice(index * 2, index * 2 + 2)),
    [inlineButton("Помощь", "menu:help")],
  ]);
}

function profileKeyboard(visible: boolean) {
  return inlineKeyboard([
    [inlineButton("Редактировать", "menu:profile:edit")],
    [inlineButton(visible ? "Скрыть" : "Опубликовать", "menu:profile:toggle")],
    [inlineButton("Удалить анкету", "menu:profile:delete")],
    [inlineButton("Назад", "menu:open")],
  ]);
}

function profileSummary(ctx: Ctx): string | undefined {
  const profile = profileFromSession(ctx);
  if (!profile || profile.deleted) return undefined;
  const visible = profile.visible !== false;
  const name = profile.displayName;
  return [
    "Моя анкета",
    "",
    `Имя: ${name}`,
    `Возраст: ${profile.age}`,
    `Город или регион: ${profile.city}`,
    `Семейный статус: ${profile.maritalStatus}`,
    `Практика: ${profile.practice}`,
    `Образование: ${profile.education}`,
    `Занятие: ${profile.occupation}`,
    `О себе: ${profile.bio}`,
    `Видимость: ${visible ? "Опубликована" : "Скрыта"}`,
    `Обновлена: ${profile.updatedAt}`,
    "",
    "Фото защищено — контакт и фото показываются только при взаимном согласии",
  ].join("\n");
}

async function openProfile(ctx: Ctx) {
  const summary = profileSummary(ctx);
  if (!summary) {
    await ctx.reply("У вас пока нет анкеты. Создайте её — это поможет найти подходящее знакомство.", {
      reply_markup: inlineKeyboard([
        [inlineButton("Создать анкету", "profile:create")],
        [inlineButton("Назад", "menu:open")],
      ]),
    });
    return;
  }
  await ctx.reply(summary, { reply_markup: profileKeyboard(profileFromSession(ctx)?.visible !== false) });
}

composer.command("menu", async (ctx) => {
  await ctx.reply("Выберите, что хотите открыть:", { reply_markup: menuKeyboard() });
});

composer.callbackQuery("menu:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  await editTextOrReply(ctx, "Выберите, что хотите открыть:", menuKeyboard());
});

composer.callbackQuery("menu:profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  await openProfile(ctx);
});

composer.callbackQuery("menu:profile:toggle", async (ctx) => {
  await ctx.answerCallbackQuery();
  const profile = profileFromSession(ctx);
  if (!profile || profile.deleted) {
    await openProfile(ctx);
    return;
  }
  profile.visible = profile.visible === false;
  profile.updatedAt = now();
  await ctx.reply(`Анкета теперь ${profile.visible ? "опубликована" : "скрыта"}.`, {
    reply_markup: profileKeyboard(profile.visible),
  });
});

composer.callbackQuery("menu:profile:delete", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Анкета, фото и связанные данные будут удалены без возможности восстановления. Подтвердить?", {
    reply_markup: inlineKeyboard([
      [inlineButton("Да, удалить", "menu:profile:delete:yes"), inlineButton("Оставить анкету", "menu:profile:delete:no")],
    ]),
  });
});

composer.callbackQuery("menu:profile:delete:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await openProfile(ctx);
});

composer.callbackQuery("menu:profile:delete:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.profile = undefined;
  ctx.session.draft = undefined;
  ctx.session.matches = undefined;
  ctx.session.liked = undefined;
  ctx.session.viewed = undefined;
  ctx.session.skipped = undefined;
  ctx.session.reports = undefined;
  ctx.session.favorites = undefined;
  ctx.session.blacklist = undefined;
  ctx.session.visitors = undefined;
  ctx.session.profilePhotos = undefined;
  ctx.session.photoRatings = undefined;
  await notifyOwner(ctx, `Участник удалил анкету (${ctx.from.id}).`);
  await ctx.reply("Анкета и связанные данные удалены. Вы сможете создать новую анкету в любое время.", {
    reply_markup: inlineKeyboard([[inlineButton("В меню", "menu:open")]]),
  });
});

composer.callbackQuery("menu:profile:edit", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!profileFromSession(ctx)) {
    await openProfile(ctx);
    return;
  }
  ctx.session.step = "menu_edit_choice";
  await ctx.reply("Что хотите изменить?", {
    reply_markup: inlineKeyboard([
      [inlineButton("Имя", "menu:edit:name"), inlineButton("Возраст", "menu:edit:age")],
      [inlineButton("Город или регион", "menu:edit:city")],
      [inlineButton("О себе", "menu:edit:bio")],
      [inlineButton("Назад", "menu:profile")],
    ]),
  });
});

composer.callbackQuery(/^menu:edit:(name|age|city|bio)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const field = ctx.callbackQuery.data.split(":").pop();
  const labels: Record<string, string> = { name: "имя", age: "возраст", city: "город или регион", bio: "короткий рассказ о себе" };
  ctx.session.step = `menu_edit:${field}`;
  await ctx.reply(`Напишите новый вариант: ${labels[field ?? ""] ?? "значение"}.`, {
    reply_markup: { force_reply: true, input_field_placeholder: labels[field ?? ""] ?? "Новый вариант" },
  });
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step ?? "";
  if (!step.startsWith("menu_edit:")) return next();
  const profile = profileFromSession(ctx);
  if (!profile) {
    ctx.session.step = undefined;
    await openProfile(ctx);
    return;
  }
  const field = step.split(":")[1];
  const value = ctx.message.text.trim();
  if (!value) {
    await ctx.reply("Значение не может быть пустым. Попробуйте ещё раз.");
    return;
  }
  if (field === "age") {
    const age = Number(value);
    if (!Number.isInteger(age) || age < 18 || age > 100) {
      await ctx.reply("Введите целое число от 18 до 100.");
      return;
    }
    profile.age = age;
  } else if (field === "name") {
    if (value.length < 2 || value.length > 60) { await ctx.reply("Имя должно быть длиной от 2 до 60 символов."); return; }
    profile.displayName = value;
  } else if (field === "city") {
    profile.city = value;
  } else if (field === "bio") {
    if (value.length < 10 || value.length > 500) { await ctx.reply("Рассказ должен быть длиной от 10 до 500 символов."); return; }
    profile.bio = value;
  }
  profile.updatedAt = now();
  ctx.session.step = undefined;
  await ctx.reply("Изменения сохранены.", { reply_markup: profileKeyboard(profile.visible !== false) });
});

export default composer;
