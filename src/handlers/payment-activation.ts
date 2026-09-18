import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard } from "../toolkit/index.js";

/**
 * Telegram only delivers successful_payment after the provider has confirmed
 * the charge.  Keeping activation on this update avoids trusting a client-side
 * button or a payment redirect.  The payment charge id makes retries safe.
 */
const composer = new Composer<Ctx>();

composer.on("pre_checkout_query", async (ctx) => {
  // Telegram requires this acknowledgement before it will deliver
  // successful_payment. Only accept invoices created by this bot.
  if (ctx.preCheckoutQuery.invoice_payload !== "nika-matchmaker") {
    await ctx.answerPreCheckoutQuery(false, "Этот платёж относится к другому счёту.");
    return;
  }
  await ctx.answerPreCheckoutQuery(true);
});

function paymentId(ctx: Ctx): string | undefined {
  const payment = ctx.message && "successful_payment" in ctx.message
    ? ctx.message.successful_payment
    : undefined;
  return payment?.telegram_payment_charge_id;
}

composer.on("message:successful_payment", async (ctx) => {
  const chargeId = paymentId(ctx);
  if (!chargeId) {
    await ctx.reply("Мы пока не можем подтвердить платёж. Напишите команде сообщества — мы поможем.");
    return;
  }

  // Telegram may retry delivery.  Do not send duplicate activation messages.
  if (ctx.session.active && ctx.session.activationPaymentId === chargeId) {
    await ctx.reply("Доступ уже активен. Рады снова вас видеть.", {
      reply_markup: inlineKeyboard([[inlineButton("Открыть меню", "menu:main")]]),
    });
    return;
  }

  try {
    // This state is written through grammY's configured session adapter. In a
    // Worker that adapter is Durable-Object-backed; in Node it is Redis when
    // REDIS_URL is configured. The operation is deterministic and retry-safe.
    ctx.session.active = true;
    ctx.session.activationPaymentId = chargeId;
    ctx.session.activationFailures = 0;
    await ctx.reply("Платёж прошёл, доступ активен. Добро пожаловать в «Никаḥ: знакомство»!", {
      reply_markup: inlineKeyboard([[inlineButton("Открыть меню", "menu:main")]]),
    });
  } catch {
    ctx.session.active = false;
    ctx.session.activationFailures = (ctx.session.activationFailures ?? 0) + 1;
    const owner = adminChatId(ctx as never);
    if (owner) {
      try {
        await ctx.api.sendMessage(owner, "Платёж получен, но активация не завершилась. Проверьте активацию аккаунта.");
      } catch {
        // A blocked or unavailable owner must not turn a user-facing recovery
        // message into another unhandled failure.
      }
    }
    try {
      await ctx.reply("Платёж получен, но активацию нужно проверить вручную. Напишите команде сообщества и сообщите, что платёж завершён.");
    } catch {
      // Telegram may be temporarily unavailable. The owner alert above is the
      // recovery path; the next successful payment update remains retry-safe.
    }
  }
});

export default composer;
