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
  complete: boolean;
  moderationStatus?: "pending" | "approved" | "rejected";
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
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
  return `${name}, ${profile.age} · ${profile.city}\nПрактика: ${profile.practice}\n${profile.bio}`;
}
