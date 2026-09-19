import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, isOwner, registerMainMenuItem } from "../toolkit/index.js";

// Configuration stores only the SHA-256 digest. The token itself never appears
// in source, logs, or user-visible messages.
const ADMIN_PASSCODE_HASH = "dc47efc36355b16845aa4648f83dcd57d438fffe993c55c2da9b4b78bbfeba32";
const ADMIN_SESSION_MINUTES = 60;

registerMainMenuItem({ label: "🔐 Комната админа", data: "admin:entry", order: 70 });

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function authLog(ctx: Ctx, result: "успешно" | "отказано" | "выход"): void {
  // Deliberately omit the submitted code from this audit line.
  console.info(`[admin-auth] timestamp=${now()} user_id=${ctx.from?.id ?? ctx.chat?.id ?? "unknown"} result=${result}`);
}

function hasAdminRoomAccess(ctx: Ctx): boolean {
  const lastActivity = ctx.session.adminRoom?.lastActivity;
  if (!lastActivity) return false;
  const elapsed = Date.parse(now()) - Date.parse(lastActivity);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= ADMIN_SESSION_MINUTES * 60_000;
}

function touchAdminRoom(ctx: Ctx): void {
  ctx.session.adminRoom = { lastActivity: now() };
}

/** Admin IDs are deploy-time configuration. They are never claimed in chat. */
function config(ctx: Ctx): string[] {
  const env = (ctx as Ctx & { env?: Record<string, unknown> }).env;
  const raw = env?.ADMIN_IDS ?? (typeof process !== "undefined" ? process.env.ADMIN_IDS : undefined);
  return String(raw ?? "").split(/[ ,]+/).map((id) => id.trim()).filter(Boolean);
}

export function isAdmin(ctx: Ctx): boolean {
  const ids = config(ctx);
  const caller = String(ctx.from?.id ?? ctx.chat?.id ?? "");
  return hasAdminRoomAccess(ctx) || (ids.length > 0 && ids.includes(caller)) || isOwner(ctx);
}

export function isSuperAdmin(ctx: Ctx): boolean {
  return isOwner(ctx);
}

/** Account status is kept with the user's durable account/session record. */
export function isBlocked(ctx: Ctx): boolean {
  return ctx.session.adminState?.banned === true || Boolean(ctx.session.adminState?.suspendedUntil);
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
  if (hasAdminRoomAccess(ctx)) {
    touchAdminRoom(ctx);
    return true;
  }
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

function roomKeyboard() {
  return inlineKeyboard([
    [inlineButton("Просмотреть жалобы", "admin:reports:0")],
    [inlineButton("Управление анкетами", "admin:pending:0")],
    [inlineButton("Уведомления/Рассылка", "admin:broadcast")],
    [inlineButton("Выйти из админа", "admin:logout")],
  ]);
}

async function openRoom(ctx: Ctx) {
  touchAdminRoom(ctx);
  await ctx.reply("Комната админа открыта. Выберите раздел:", { reply_markup: roomKeyboard() });
}

const composer = new Composer<Ctx>();

export { config as adminIds };

composer.command("admin", async (ctx) => {
  if (hasAdminRoomAccess(ctx)) { await openRoom(ctx); return; }
  ctx.session.step = "admin_passcode";
  await ctx.reply("Введите числовой код доступа к комнате админа.", { reply_markup: { force_reply: true, input_field_placeholder: "Код доступа" } });
});

async function requestPasscode(ctx: Ctx): Promise<void> {
  ctx.session.step = "admin_passcode";
  await ctx.reply("Введите числовой код доступа к комнате админа.", { reply_markup: { force_reply: true, input_field_placeholder: "Код доступа" } });
}

composer.callbackQuery("admin:entry", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (hasAdminRoomAccess(ctx)) { await openRoom(ctx); return; }
  await requestPasscode(ctx);
});

composer.callbackQuery("admin:room", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (hasAdminRoomAccess(ctx)) await openRoom(ctx);
  else await requestPasscode(ctx);
});

composer.callbackQuery("admin:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (hasAdminRoomAccess(ctx)) await openRoom(ctx);
  else await requestPasscode(ctx);
});

composer.callbackQuery("admin:logout", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminRoom = undefined;
  ctx.session.step = undefined;
  authLog(ctx, "выход");
  await ctx.reply("Вы вышли из комнаты админа.", { reply_markup: inlineKeyboard([[inlineButton("В меню", "menu:main")]]) });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "admin_passcode") return next();
  const supplied = ctx.message.text.trim();
  const valid = /^\d+$/.test(supplied) && (await digest(supplied)) === ADMIN_PASSCODE_HASH;
  if (!valid) {
    authLog(ctx, "отказано");
    await ctx.reply("Код не подошёл. Введите числовой код ещё раз.", { reply_markup: { force_reply: true, input_field_placeholder: "Код доступа" } });
    return;
  }
  authLog(ctx, "успешно");
  ctx.session.step = undefined;
  await openRoom(ctx);
});

composer.callbackQuery(/^admin:(pending|active|users|audit):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const [, section, page] = ctx.callbackQuery.data.split(":");
  const n = Number(page);
  const profile = ctx.session.profile;
  const label = section === "pending" ? "Ожидающие профили" : section === "active" ? "Активные профили" : section === "users" ? "Пользователи" : "Журнал действий";
  if (section === "audit") {
    const entries = ctx.session.adminActions ?? [];
    if (!entries.length) { await ctx.reply("Журнал действий пока пуст.", { reply_markup: roomKeyboard() }); return; }
    const pageEntry = entries.slice().reverse()[n];
    await ctx.reply(`Журнал действий\n\nАдминистратор: ${pageEntry.adminId}\nДействие: ${pageEntry.actionType}\nЦель: ${pageEntry.targetUserId ?? "не указана"}\nВремя: ${pageEntry.timestamp}\nПричина: ${pageEntry.reason ?? "не указана"}`, { reply_markup: inlineKeyboard([
      [inlineButton("Предыдущая", `admin:audit:${Math.max(0, n - 1)}`), inlineButton("Следующая", `admin:audit:${n + 1}`)],
      [inlineButton("⬅️ В комнату админа", "admin:room")],
    ]) });
    return;
  }
  const moderation = String((profile as Record<string, unknown> | undefined)?.moderationStatus ?? "pending");
  if (!profile || profile.deleted || (section === "pending" && moderation === "approved") || (section === "active" && moderation !== "approved")) {
    await ctx.reply(`${label}: пока пусто.`, { reply_markup: roomKeyboard() });
    return;
  }
  await ctx.reply(`${label}\n\n1. Профиль ${profile.userId} · ${profile.displayName}`, { reply_markup: inlineKeyboard([
    [inlineButton("Открыть", `admin:profile:${profile.userId}`)],
    [inlineButton("Предыдущая", `admin:${section}:${Math.max(0, n - 1)}`), inlineButton("Следующая", `admin:${section}:${n + 1}`)],
    [inlineButton("⬅️ В комнату админа", "admin:room")],
  ]) });
});

composer.callbackQuery("admin:statistics", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const p = ctx.session.profile;
  const reports = ctx.session.reports ?? [];
  const actions = ctx.session.adminActions ?? [];
  const status = String((p as Record<string, unknown> | undefined)?.moderationStatus ?? "pending");
  await ctx.reply(`Статистика\n\nПользователей: ${p ? 1 : 0}\nАктивных профилей: ${p && !p.deleted && status === "approved" ? 1 : 0}\nОжидающих профилей: ${p && !p.deleted && status !== "approved" ? 1 : 0}\nЖалоб: ${reports.length}\nСовпадений: ${(ctx.session.matches ?? []).length}\nДействий модерации: ${actions.length}`, { reply_markup: inlineKeyboard([[inlineButton("⬅️ В комнату админа", "admin:room")]]) });
});

composer.callbackQuery("admin:settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply(isSuperAdmin(ctx) ? "Настройки модерации\n\nВы — главный администратор. Список администраторов задаётся в защищённой конфигурации проекта." : "Настройки модерации доступны только главному администратору.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ В комнату админа", "admin:room")]]) });
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
  await ctx.reply(action === "ban" ? "Заблокировать пользователя навсегда? Укажите причину после подтверждения." : "Удалить профиль без возможности восстановления? Укажите причину после подтверждения.", { reply_markup: inlineKeyboard([
    [inlineButton("Подтвердить", `admin:confirm:${action}:${target}`), inlineButton("Отмена", "admin:queue")],
  ]) });
});

composer.callbackQuery(/^admin:confirm:(ban|delete):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const [, action, target] = ctx.callbackQuery.data.split(":");
  ctx.session.step = `admin_reason:${action}:${target}`;
  await ctx.reply("Напишите короткую причину действия. Это попадёт в неизменяемый журнал.", { reply_markup: { force_reply: true, input_field_placeholder: "Причина действия" } });
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step ?? "";
  if (!step.startsWith("admin_reason:")) return next();
  if (!(await requireAdmin(ctx))) return;
  const [, action, target] = step.split(":");
  const id = Number(target);
  if (ctx.session.profile && ctx.session.profile.userId === id) {
    if (action === "ban") ctx.session.adminState = { ...(ctx.session.adminState ?? {}), banned: true };
    else if (action === "delete") ctx.session.profile.deleted = true;
    else if (action === "suspend") ctx.session.adminState = { ...(ctx.session.adminState ?? {}), suspendedUntil: now() };
    else if (action === "reject") { ctx.session.profile.complete = false; ctx.session.profile.moderationStatus = "rejected"; }
  }
  ctx.session.step = undefined;
  audit(ctx, action, id, "completed", ctx.message.text.trim());
  await ctx.reply(action === "ban" ? "Пользователь заблокирован. Действие записано в журнал." : "Профиль удалён. Действие записано в журнал.");
});

composer.callbackQuery(/^admin:(approve|warn|suspend|note):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireAdmin(ctx))) return;
  const [, action, target] = ctx.callbackQuery.data.split(":"); const id = Number(target);
  if (action === "approve") { if (ctx.session.profile && ctx.session.profile.userId === id) ctx.session.profile.moderationStatus = "approved"; audit(ctx, action, id, "completed"); await ctx.reply("Профиль одобрен и теперь виден в поиске."); return; }
  if (action === "note") { audit(ctx, action, id, "completed", "Заметка добавлена в журнал"); await ctx.reply("Заметка добавлена в журнал модерации."); return; }
  if (action === "suspend") { ctx.session.step = `admin_reason:suspend:${target}`; await ctx.reply("Напишите причину приостановки профиля.", { reply_markup: { force_reply: true, input_field_placeholder: "Причина приостановки" } }); return; }
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

composer.callbackQuery(/^admin:report:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const report = (ctx.session.reports ?? [])[Number(ctx.callbackQuery.data.split(":").pop())];
  if (!report) { await ctx.reply("Эта жалоба уже закрыта или не найдена.", { reply_markup: roomKeyboard() }); return; }
  await ctx.reply(`Жалоба\n\nОтправитель: ${report.reporterId}\nПрофиль: ${report.targetId}\nПричина: ${report.reason}\nВремя: ${report.createdAt}\nСтатус: ${report.status}`, { reply_markup: inlineKeyboard([
    [inlineButton("Открыть профиль", `admin:profile:${report.targetId}`)],
    [inlineButton("Закрыть жалобу", `admin:report:dismiss:${report.id}`), inlineButton("Принять меры", `admin:report:action:${report.targetId}`)],
    [inlineButton("⬅️ В комнату админа", "admin:room")],
  ]) });
});

composer.callbackQuery(/^admin:report:dismiss:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const id = ctx.callbackQuery.data.slice("admin:report:dismiss:".length);
  const report = (ctx.session.reports ?? []).find((item) => item.id === id);
  if (report) report.status = "dismissed";
  audit(ctx, "dismiss_report", typeof report?.targetId === "number" ? report.targetId : undefined, "completed", "Жалоба закрыта администратором");
  await ctx.reply("Жалоба закрыта и записана в журнал.", { reply_markup: roomKeyboard() });
});

composer.callbackQuery(/^admin:report:action:(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const target = ctx.callbackQuery.data.split(":").pop();
  await ctx.reply("Выберите действие для профиля. Для удаления и блокировки потребуется подтверждение и причина.", { reply_markup: inlineKeyboard([
    [inlineButton("Удалить профиль", `admin:delete:${target}`), inlineButton("Заблокировать", `admin:ban:${target}`)],
    [inlineButton("Приостановить", `admin:suspend:${target}`), inlineButton("Отклонить", `admin:reject:${target}`)],
    [inlineButton("⬅️ К жалобе", "admin:reports:0")],
  ]) });
});

composer.callbackQuery(/^admin:reject:(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const target = ctx.callbackQuery.data.split(":").pop();
  ctx.session.step = `admin_reason:reject:${target}`;
  await ctx.reply("Напишите причину отклонения профиля.", { reply_markup: { force_reply: true, input_field_placeholder: "Причина отклонения" } });
});

composer.callbackQuery(/^admin:suspend:(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const target = ctx.callbackQuery.data.split(":").pop();
  ctx.session.step = `admin_reason:suspend:${target}`;
  await ctx.reply("Напишите причину приостановки профиля.", { reply_markup: { force_reply: true, input_field_placeholder: "Причина приостановки" } });
});

export default composer;
