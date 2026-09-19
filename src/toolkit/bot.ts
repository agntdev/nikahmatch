import {
  Bot,
  session,
  type Context,
  type SessionFlavor,
  type StorageAdapter,
} from "grammy";
import { resolveSessionStorage } from "./session/redis.js";
import {
  installActivityReporter,
  type ReporterOptions,
  type TelemetryEnv,
} from "./telemetry/reporter.js";

// A small shared durable namespace for domain indexes. Feature handlers use this
// through the helpers below instead of keeping cross-user data in process memory.
// It is backed by the same Redis/DO adapter selected for sessions.
let sharedAdapter: StorageAdapter<unknown> | undefined;

export function setSharedStorage(adapter: StorageAdapter<unknown>): void {
  sharedAdapter = adapter;
}

export async function readShared<T>(key: string): Promise<T | undefined> {
  return sharedAdapter?.read(key) as Promise<T | undefined>;
}

export async function writeShared<T>(key: string, value: T): Promise<void> {
  if (!sharedAdapter) throw new Error("shared storage is not configured");
  await sharedAdapter.write(key, value as unknown);
}

export async function deleteShared(key: string): Promise<void> {
  await sharedAdapter?.delete(key);
}

/** Context for a toolkit bot carrying a typed session `S`. */
export type BotContext<S extends object = Record<string, unknown>> = Context & SessionFlavor<S>;

export interface CreateBotOptions<S extends object> {
  /** Initial session value for a new chat. */
  initial: () => S;
  /**
   * Session storage. When omitted, the toolkit auto-selects: Redis if
   * REDIS_URL is set in the environment (production), else in-memory
   * (development / no Redis). Pass an explicit adapter to override.
   */
  storage?: StorageAdapter<S>;
  /** Worker bindings; omitted on Node, where the reporter reads process.env. */
  telemetryEnv?: TelemetryEnv;
  /** Runtime-specific reporter behavior, such as per-update Worker flushing. */
  telemetryReporterOptions?: ReporterOptions;
  /** Called on any unhandled handler error; defaults to console.error. */
  onError?: (err: unknown) => void;
}

/**
 * createBot — the toolkit's curated entry point. Wraps grammY's Bot with the
 * default session middleware and an error boundary, so every generated bot
 * shares one opinionated structure: the Dev-stage codegen targets this API, and
 * the test harness (M0-10) replays Updates against bots built here.
 *
 * The BotFather token is injected at runtime (never baked); polling vs webhook
 * is chosen at deploy time (docs/pivot M1-7).
 */
export function createBot<S extends object>(
  token: string,
  opts: CreateBotOptions<S>,
): Bot<BotContext<S>> {
  const storage = resolveSessionStorage<S>(opts.storage);
  setSharedStorage(storage as unknown as StorageAdapter<unknown>);
  const bot = new Bot<BotContext<S>>(token);
  // Telegram can deliver a callback after its acknowledgement window, and an
  // inline button may be attached to a photo rather than a text message. Both
  // are normal races, not user-visible failures. Keep them out of the global
  // error boundary and recover an edit as a fresh message when necessary.
  bot.api.config.use(async (prev, method, payload) => {
    try {
      return await prev(method, payload);
    } catch (error) {
      const message = String(error);
      if (method === "answerCallbackQuery" && /(too old|timeout|invalid|expired)/i.test(message)) {
        return { ok: true, result: true } as never;
      }
      if (method === "editMessageText" && /(there is no text in the message to edit|message.*text.*edit|can't be edited|can not be edited)/i.test(message)) {
        const p = payload as Record<string, unknown>;
        if (typeof p.chat_id === "number" || typeof p.chat_id === "string") {
          const fallback = { ...p };
          delete fallback.message_id;
          delete fallback.inline_message_id;
          return prev("sendMessage", fallback as never);
        }
      }
      throw error;
    }
  });
  bot.use(
    session<S, BotContext<S>>({
      initial: opts.initial,
      // Auto-select: explicit adapter → Redis (REDIS_URL) → in-memory.
      storage,
    }),
  );
  // Callback queries can arrive after Telegram's short acknowledgement window
  // (for example after a user resumes an old card). Treat that race as a
  // completed acknowledgement so it never reaches the global error boundary.
  bot.use(async (ctx, next) => {
    const original = ctx.answerCallbackQuery.bind(ctx);
    ctx.answerCallbackQuery = (async (...args: Parameters<typeof ctx.answerCallbackQuery>) => {
      try {
        return await original(...args);
      } catch (error) {
        if (/(too old|timeout|invalid|expired)/i.test(String(error))) return true;
        throw error;
      }
    }) as typeof ctx.answerCallbackQuery;
    await next();
  });
  // Active-user reporting (agnt-api migration 00069). No-op unless the platform
  // injected BOT_TELEMETRY_* at deploy — so dev, the test harness, and old bots
  // are byte-for-byte unchanged. Records salted user hashes only; best-effort.
  installActivityReporter(bot, opts.telemetryEnv, opts.telemetryReporterOptions);
  bot.catch((err) => {
    if (opts.onError) opts.onError(err);
    else console.error("[agntdev-bot] unhandled error:", err);
  });
  return bot;
}

/**
 * Publish the bot's slash-command menu to Telegram (the "/" list + Menu button),
 * so the few commands a button-first bot DOES expose are discoverable. A
 * button-first bot should publish only `/start` and `/help` (plus any rare
 * free-form-input command); everything else is reached by tapping a menu button.
 *
 * Call once at startup (see `src/index.ts`). No-ops harmlessly under the test
 * harness (the Bot API transport is faked there). `extra` appends bot-specific
 * commands beyond the `/start` + `/help` defaults.
 */
export async function setDefaultCommands<S extends object>(
  bot: Bot<BotContext<S>>,
  extra: ReadonlyArray<{ command: string; description: string }> = [],
): Promise<void> {
  const commands = [
    { command: "start", description: "Открыть меню" },
    { command: "help", description: "Как работает бот" },
    ...extra,
  ];
  try {
    await bot.api.setMyCommands(commands);
  } catch {
    // Non-fatal: discoverability only. Never block startup on it.
  }
}
