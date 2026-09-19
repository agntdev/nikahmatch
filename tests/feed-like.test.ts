import { describe, expect, it } from "vitest";
import type { Transformer } from "grammy";
import { buildBot, type Session } from "../src/bot.js";
import { MemorySessionStorage } from "../src/toolkit/index.js";
import { callbackUpdate } from "../src/toolkit/harness/updates.js";

describe("feed likes", () => {
  it("creates one like, then removes it and updates the card state", async () => {
    const storage = new MemorySessionStorage<Session>();
    storage.write("1", {
      language: "ru",
      feedPosts: [{
        postId: "post-1",
        authorUserId: 7,
        photoFileId: "photo-1",
        captionText: "Тёплая запись",
        createdAt: "2026-01-01T00:00:00.000Z",
        visibility: "public",
        likesCount: 0,
        dislikesCount: 0,
      }],
      feedLikes: [],
    });
    const bot = await buildBot("test-token", { storage });
    bot.botInfo = { id: 42, is_bot: true, first_name: "TestBot", username: "test_bot" } as never;
    const calls: Array<{ method: string; payload: Record<string, any> }> = [];
    const capture: Transformer = async (_prev, method, payload) => {
      calls.push({ method, payload: (payload ?? {}) as Record<string, any> });
      return { ok: true, result: true } as never;
    };
    bot.api.config.use(capture);

    await bot.handleUpdate(callbackUpdate(1, "feed:like:post-1", { userId: 8 }));
    const firstPhoto = calls.find((call) => call.method === "sendPhoto");
    expect(firstPhoto?.payload.caption).toContain("Нравится: 1");
    expect(firstPhoto?.payload.reply_markup.inline_keyboard[0][0].text).toContain("♥️");
    expect(storage.read("1")?.feedLikes).toHaveLength(1);

    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(2, "feed:like:post-1", { userId: 8 }));
    const secondPhoto = calls.find((call) => call.method === "sendPhoto");
    expect(secondPhoto?.payload.caption).toContain("Нравится: 0");
    expect(secondPhoto?.payload.reply_markup.inline_keyboard[0][0].text).toContain("♡");
    expect(storage.read("1")?.feedLikes).toHaveLength(0);
  });
});
