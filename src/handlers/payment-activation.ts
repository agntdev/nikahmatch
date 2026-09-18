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
    await ctx.answerPreCheckoutQuery(false, "That payment belongs to another invoice.");
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
    await ctx.reply("We couldn’t verify that payment yet. Please contact the community team so we can help.");
    return;
  }

  // Telegram may retry delivery.  Do not send duplicate activation messages.
  if (ctx.session.active && ctx.session.activationPaymentId === chargeId) {
    await ctx.reply("Your access is already active. Welcome back.", {
      reply_markup: inlineKeyboard([[inlineButton("Open the menu", "menu:main")]]),
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
    await ctx.reply("Your payment went through and your access is active. Welcome to Nikaḥ Matchmaker!", {
      reply_markup: inlineKeyboard([[inlineButton("Open the menu", "menu:main")]]),
    });
  } catch {
    ctx.session.active = false;
    ctx.session.activationFailures = (ctx.session.activationFailures ?? 0) + 1;
    const owner = adminChatId(ctx as never);
    if (owner) {
      try {
        await ctx.api.sendMessage(owner, "Payment received, but account activation failed. Please review the activation logs.");
      } catch {
        // A blocked or unavailable owner must not turn a user-facing recovery
        // message into another unhandled failure.
      }
    }
    try {
      await ctx.reply("We received your payment, but activation needs a quick manual check. Please contact the community team and mention that your payment is complete.");
    } catch {
      // Telegram may be temporarily unavailable. The owner alert above is the
      // recovery path; the next successful payment update remains retry-safe.
    }
  }
});

export default composer;
