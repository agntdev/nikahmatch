import type { Ctx } from "./bot.js";
import { adminChatId } from "./toolkit/index.js";
import type { InlineKeyboardMarkup } from "./toolkit/ui/keyboard.js";

export type Profile = {
  userId: number;
  displayName: string;
  age: number;
  gender: string;
  city: string;
  maritalStatus: string;
  sect?: string;
  practice: string;
  education: string;
  occupation: string;
  bio: string;
  photos?: string[];
  fullName?: string;
  hideName: boolean;
  hidePhotos: boolean;
  visible?: boolean;
  complete: boolean;
  moderationStatus?: "pending" | "approved" | "rejected";
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
  fundraisingPurposeText?: string;
  fundraisingTargetAmount?: number;
  fundraisingTargetCurrency?: string;
  fundraising_purpose_text?: string;
  fundraising_target_amount?: number;
  fundraising_target_currency?: string;
};

export type Report = {
  id: string;
  reporterId: number;
  targetId: number;
  reason: string;
  details?: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
};

let clock = (): Date => new Date();
export const now = (): string => clock().toISOString();
export const setNow = (next: () => Date): void => { clock = next; };

/** A stale callback is a normal Telegram race; never let it break the action. */
export async function answerCallbackSafely(ctx: Ctx): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    if (!/(too old|timeout|invalid|expired)/i.test(String(error))) throw error;
  }
}

/**
 * Inline buttons can be attached to text messages or media messages. Telegram
 * only permits editMessageText for the former, so menu-like callbacks must
 * reply when their originating message is a photo, video, or other media.
 */
export async function editTextOrReply(
  ctx: Ctx,
  text: string,
  replyMarkup: InlineKeyboardMarkup,
): Promise<void> {
  const source = ctx.callbackQuery?.message;
  if (!source || typeof source.text !== "string") {
    await ctx.reply(text, { reply_markup: replyMarkup });
    return;
  }
  try {
    await ctx.editMessageText(text, { reply_markup: replyMarkup });
  } catch (error) {
    // Deleted/expired messages are recoverable: show the destination as a new
    // message instead of leaving the user at a dead button.
    if (/(message to edit|message.*text|can't be edited|can not be edited)/i.test(String(error))) {
      await ctx.reply(text, { reply_markup: replyMarkup });
      return;
    }
    throw error;
  }
}

export function profileFromSession(ctx: Ctx): Profile | undefined {
  const value = ctx.session.profile;
  return value as Profile | undefined;
}

export function draftFromSession(ctx: Ctx): Partial<Profile> {
  return (ctx.session.draft ?? {}) as Partial<Profile>;
}

export function keyboardBack() {
  return { inline_keyboard: [[{ text: "⬅️ В меню", callback_data: "menu:main" }]] };
}

export async function notifyOwner(ctx: Ctx, text: string, replyMarkup?: unknown): Promise<boolean> {
  const owner = adminChatId(ctx as never);
  if (!owner) return false;
  try {
    await ctx.api.sendMessage(owner, text, replyMarkup ? { reply_markup: replyMarkup as never } : undefined);
    return true;
  } catch {
    return false;
  }
}

export function profileLabel(profile: Profile, viewerId?: number): string {
  if (profile.hideName && profile.userId !== viewerId) return "Участник сообщества";
  return profile.displayName;
}

export function profileCard(profile: Profile, viewerId?: number): string {
  const name = profileLabel(profile, viewerId);
  const purposeText = profile.fundraisingPurposeText ?? profile.fundraising_purpose_text;
  const amountValue = profile.fundraisingTargetAmount ?? profile.fundraising_target_amount;
  const currency = profile.fundraisingTargetCurrency ?? profile.fundraising_target_currency;
  const purpose = purposeText
    ? `\n🎯 Цель: ${purposeText.slice(0, 80)}${purposeText.length > 80 ? "…" : ""}`
    : "";
  const amount = amountValue !== undefined && currency
    ? `\nСумма: ${amountValue} ${currency}`
    : "";
  return `${name}, ${profile.age} · ${profile.city}\nПрактика: ${profile.practice}\n${profile.bio}${purpose}${amount}`;
}

/** Keep user-provided profile text safe and free of off-platform donation links. */
export function sanitizePurpose(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/[<>*_`[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Feed captions are plain text: strip markup-like characters and cap at 500. */
export function sanitizeCaption(value: string): string {
  return value.replace(/[<>*_`[\]{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function purposeSummary(profile: Partial<Profile>): string {
  const purposeText = profile.fundraisingPurposeText ?? profile.fundraising_purpose_text;
  const amountValue = profile.fundraisingTargetAmount ?? profile.fundraising_target_amount;
  const currency = profile.fundraisingTargetCurrency ?? profile.fundraising_target_currency;
  if (!purposeText) return "";
  const preview = purposeText.slice(0, 120);
  const suffix = purposeText.length > 120 ? "…" : "";
  const amount = amountValue !== undefined && currency
    ? ` · ${amountValue} ${currency}`
    : "";
  return `🎯 Цель: ${preview}${suffix}${amount}`;
}
