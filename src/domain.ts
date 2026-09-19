import type { Ctx } from "./bot.js";
import { adminChatId } from "./toolkit/index.js";

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
