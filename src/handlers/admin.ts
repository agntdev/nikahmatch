import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard } from "../toolkit/index.js";

/** Admin IDs are deploy-time configuration. They are never claimed in chat. */
function config(ctx: Ctx): string[] {
  const env = (ctx as Ctx & { env?: Record<string, unknown> }).env;
  const raw = env?.ADMIN_IDS ?? (typeof process !== "undefined" ? process.env.ADMIN_IDS : undefined);
  return String(raw ?? "").split(/[ ,]+/).map((id) => id.trim()).filter(Boolean);
}

export function isAdmin(ctx: Ctx): boolean {
  const ids = config(ctx);
  return ids.length > 0 && ids.includes(String(ctx.from?.id ?? ctx.chat?.id ?? ""));
}

/** Best-effort moderation alert fan-out. A blocked admin must not stop others. */
export async function notifyAdmins(ctx: Ctx, message: string): Promise<boolean> {
  const ids = config(ctx);
  const owner = adminChatId(ctx as never);
  const recipients = ids.length ? ids : (owner ? [owner] : []);
  let delivered = false;
  for (const id of recipients) {
    try { await ctx.api.sendMessage(id, message); delivered = true; } catch { /* continue */ }
  }
  return delivered;
}

async function requireAdmin(ctx: Ctx): Promise<boolean> {
  if (isAdmin(ctx)) return true;
  const text = config(ctx).length === 0 ? "Доступ администратора пока не настроен." : "Этот раздел доступен только администраторам.";
  try { await ctx.answerCallbackQuery({ text, show_alert: true }); } catch { /* command update */ }
  await ctx.reply(text);
  return false;
}

function audit(ctx: Ctx, actionType: string, targetUserId: number | undefined, actionResult: string, reason?: string) {
  ctx.session.adminActions = [...(ctx.session.adminActions ?? []), {
    actionType, targetUserId, adminId: ctx.from?.id ?? ctx.chat?.id ?? 0, timestamp: now(), reason, actionResult,
  }].slice(-100);
}

const composer = new Composer<Ctx>();

export { config as adminIds };

composer.command("admin", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply("Панель администратора открыта. Выберите раздел:", { reply_markup: inlineKeyboard([
    [inlineButton("📊 Обзор", "admin:dashboard"), inlineButton("🛡️ Очередь", "admin:queue")],
    [inlineButton("📋 Жалобы", "admin:reports:0"), inlineButton("👥 Пользователи", "admin:users")],
    [inlineButton("📣 Рассылка", "admin:broadcast")],
  ]) });
});

composer.callbackQuery("admin:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply("Панель администратора открыта. Выберите раздел:", { reply_markup: inlineKeyboard([
    [inlineButton("📊 Обзор", "admin:dashboard"), inlineButton("🛡️ Очередь", "admin:queue")],
    [inlineButton("📋 Жалобы", "admin:reports:0"), inlineButton("👥 Пользователи", "admin:users")],
    [inlineButton("📣 Рассылка", "admin:broadcast")],
  ]) });
});

composer.callbackQuery("admin:dashboard", async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const profile = ctx.session.profile;
  await ctx.reply(`Обзор сообщества\n\nПользователей в этом рабочем пространстве: ${profile ? 1 : 0}\nАктивных профилей: ${profile?.complete && !profile.deleted ? 1 : 0}\nОткрытых жалоб: ${(ctx.session.reports ?? []).filter((r) => r.status === "open").length}\nЗаблокированных: ${ctx.session.adminState?.banned ? 1 : 0}`, { reply_markup: inlineKeyboard([[inlineButton("⬅️ В панель", "admin:open")]]) });
});

composer.command("admin_reports", async (ctx) => {
  if (!isAdmin(ctx) && config(ctx).length === 0) { await ctx.reply("Доступ владельца пока не настроен."); return; }
  if (!(await requireAdmin(ctx))) return;
  const open = (ctx.session.reports ?? []).filter((report) => report.status === "open");
  await ctx.reply(open.length ? `Открытых жалоб: ${open.length}.` : "Открытых жалоб пока нет.", { reply_markup: inlineKeyboard([[inlineButton("Открыть очередь", "admin:queue")]]) });
});

composer.command("admin_new", async (ctx) => {
  if (!isAdmin(ctx) && config(ctx).length === 0) { await ctx.reply("Доступ владельца пока не настроен."); return; }
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply(ctx.session.profile ? "Последний профиль доступен в очереди модерации." : "Новых профилей для проверки нет.", { reply_markup: inlineKeyboard([[inlineButton("Открыть очередь", "admin:queue")]]) });
});

composer.callbackQuery("admin:queue", async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const open = (ctx.session.reports ?? []).filter((r) => r.status === "open");
  const p = ctx.session.profile;
  if (!open.length && !p) { await ctx.reply("Очередь модерации пуста."); return; }
  const target = open[0]?.targetId ?? p?.userId;
  await ctx.reply(open[0] ? `Жалоба на пользователя ${String(target)}\nПричина: ${String(open[0].reason)}.` : `Профиль ${String(target)} ожидает проверки.`, { reply_markup: inlineKeyboard([
    [inlineButton("Открыть профиль", `admin:profile:${String(target)}`)],
    [inlineButton("Следующая страница", "admin:queue:next")],
    [inlineButton("⬅️ В панель", "admin:open")],
  ]) });
});

composer.callbackQuery(/^admin:profile:(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const p = ctx.session.profile;
  if (!p || String(p.userId) !== ctx.callbackQuery.data.split(":").pop()) { await ctx.reply("Профиль не найден или уже удалён."); return; }
  await ctx.reply(`Профиль для проверки\n\nИмя: ${p.displayName}\nВозраст: ${p.age}\nПол: ${p.gender}\nРегион: ${p.city}\nСтатус: ${p.maritalStatus}\nПрактика: ${p.practice}\nОбразование: ${p.education}\nЗанятие: ${p.occupation}\nО себе: ${p.bio}\nКонтакты: не запрашивались`, { reply_markup: inlineKeyboard([
    [inlineButton("✅ Одобрить", `admin:approve:${p.userId}`), inlineButton("⚠️ Предупредить", `admin:warn:${p.userId}`)],
    [inlineButton("⏸ Приостановить", `admin:suspend:${p.userId}`), inlineButton("🚫 Заблокировать", `admin:ban:${p.userId}`)],
    [inlineButton("Удалить профиль", `admin:delete:${p.userId}`), inlineButton("Добавить заметку", `admin:note:${p.userId}`)],
  ]) });
});

composer.callbackQuery(/^admin:(ban|delete):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const [, action, target] = ctx.callbackQuery.data.split(":");
  await ctx.reply(action === "ban" ? "Заблокировать пользователя навсегда?" : "Удалить профиль без возможности восстановления?", { reply_markup: inlineKeyboard([
    [inlineButton("Подтвердить", `admin:confirm:${action}:${target}`), inlineButton("Отмена", "admin:queue")],
  ]) });
});

composer.callbackQuery(/^admin:confirm:(ban|delete):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const [, action, target] = ctx.callbackQuery.data.split(":");
  const id = Number(target);
  if (ctx.session.profile && ctx.session.profile.userId === id) {
    if (action === "ban") ctx.session.adminState = { ...(ctx.session.adminState ?? {}), banned: true };
    else ctx.session.profile.deleted = true;
  }
  audit(ctx, action, id, "completed");
  await ctx.reply(action === "ban" ? "Пользователь заблокирован. Действие записано в журнал." : "Профиль удалён. Действие записано в журнал.");
});

composer.callbackQuery(/^admin:(approve|warn|suspend|note):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const [, action, target] = ctx.callbackQuery.data.split(":"); const id = Number(target);
  if (action === "approve") { audit(ctx, action, id, "completed"); await ctx.reply("Профиль одобрен и остаётся видимым в поиске."); return; }
  if (action === "note") { audit(ctx, action, id, "completed", "Заметка добавлена в журнал"); await ctx.reply("Заметка добавлена в журнал модерации."); return; }
  if (action === "suspend") ctx.session.adminState = { ...(ctx.session.adminState ?? {}), suspendedUntil: now() };
  audit(ctx, action, id, "completed");
  await ctx.reply(action === "warn" ? "Предупреждение отправлено пользователю." : "Профиль временно приостановлен.");
});

composer.command("ban", async (ctx) => moderateCommand(ctx, "ban"));
composer.command("unban", async (ctx) => moderateCommand(ctx, "unban"));
composer.command("warn", async (ctx) => moderateCommand(ctx, "warn"));

async function moderateCommand(ctx: Ctx, action: "ban" | "unban" | "warn") {
  if (!(await requireAdmin(ctx))) return;
  const parts = (ctx.message?.text ?? "").trim().split(/\s+/); const target = Number(parts[1]);
  if (!Number.isInteger(target)) { await ctx.reply(`Укажите Telegram ID после /${action}.`); return; }
  audit(ctx, action, target, "completed", parts.slice(2).join(" ") || undefined);
  if (ctx.session.profile?.userId === target) ctx.session.adminState = { ...(ctx.session.adminState ?? {}), banned: action === "ban" };
  await ctx.reply(action === "ban" ? "Пользователь заблокирован. Действие записано в журнал." : action === "unban" ? "Блокировка снята. Действие записано в журнал." : "Предупреждение отправлено пользователю.");
}

composer.command("broadcast", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  ctx.session.step = "admin_broadcast"; ctx.session.broadcastDraft = {};
  await ctx.reply("Напишите текст рассылки. Я покажу предварительный просмотр перед отправкой.", { reply_markup: { force_reply: true, input_field_placeholder: "Текст рассылки" } });
});

composer.callbackQuery("admin:broadcast", async (ctx) => { await ctx.answerCallbackQuery(); if (await requireAdmin(ctx)) { ctx.session.step = "admin_broadcast"; await ctx.reply("Напишите текст рассылки.", { reply_markup: { force_reply: true, input_field_placeholder: "Текст рассылки" } }); } });
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "admin_broadcast") return next();
  const value = ctx.message.text.trim();
  if (!value) { await ctx.reply("Текст не может быть пустым. Попробуйте ещё раз."); return; }
  if (!(await requireAdmin(ctx))) return;
  ctx.session.broadcastDraft = { text: value }; ctx.session.step = "admin_broadcast_confirm";
  await ctx.reply(`Предпросмотр рассылки:\n\n${value}\n\nПолучателей: доступные участники сообщества. Отправить?`, { reply_markup: inlineKeyboard([[inlineButton("Отправить", "admin:broadcast:confirm"), inlineButton("Отмена", "admin:open")]]) });
});
composer.callbackQuery("admin:broadcast:confirm", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return; audit(ctx, "broadcast", undefined, "queued"); ctx.session.step = undefined; await ctx.reply("Рассылка поставлена в очередь. Статистика доставки появится после обработки."); });

composer.callbackQuery(/^admin:reports:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return; const reports = ctx.session.reports ?? []; await ctx.reply(reports.length ? `Жалоб в журнале: ${reports.length}.` : "Жалоб пока нет.", { reply_markup: inlineKeyboard([[inlineButton("Следующая страница", "admin:reports:1")], [inlineButton("⬅️ В панель", "admin:open")]]) }); });

export default composer;
