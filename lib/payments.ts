import { z } from "zod";
import { AppError, db, setting } from "./server";
import { checkPayment, createCheckout, type PaymentEvent } from "./infinitepay";
import { issueShipment } from "./shipments";

type Payment = { order_id: string; reference: string; handle: string; amount_cents: number; checkout_url: string | null; lease_until: number; transaction_nsu: string | null; paid_at: number | null; capture_method: string | null };
export function paymentConfig() {
  const handle = setting("INFINITEPAY_HANDLE").replace(/^\$/, "");
  const origin = setting("PUBLIC_SITE_URL");
  let originValid = false;
  try { const url = new URL(origin); originValid = url.origin === origin && url.protocol === "https:" && !url.username && !url.password; } catch {}
  return { handle, origin, ready: /^[a-zA-Z0-9._-]{1,100}$/.test(handle) && originValid };
}

export const orderAccessSchema = z.object({ id: z.string().regex(/^PC-[0-9A-F-]{36}$/), key: z.string().uuid() });
export async function ownedOrder(id: string, key: string) {
  const order = await db().prepare("SELECT id,status,mode,service,total_cents FROM orders WHERE id=? AND idempotency_key=?")
    .bind(id, key).first<{ id: string; status: string; mode: string; service: string | null; total_cents: number | null }>();
  if (!order) throw new AppError("Solicitação não encontrada. Use o mesmo formulário em que fez o pedido.", 404);
  return order;
}

export async function startCheckout(id: string, key: string) {
  const order = await ownedOrder(id, key);
  if (order.mode !== "shipping" || !order.total_cents || !order.service) throw new AppError("O cofre não exige pagamento.", 409);
  if (order.status === "pago_pronto_envio") return { status: order.status };
  if (order.status !== "aguardando_pagamento") throw new AppError("Este pedido não está disponível para pagamento.", 409);
  let payment = await db().prepare("SELECT * FROM order_payments WHERE order_id=?").bind(id).first<Payment>();
  if (payment?.checkout_url) return { url: payment.checkout_url, status: order.status };
  const config = paymentConfig();
  if (!config.ready) throw new AppError("O pagamento online está aguardando a configuração da loja. A equipe pode orientar você pelo telefone informado.", 503);
  const now = Date.now();
  await db().prepare("INSERT INTO order_payments (order_id,reference,handle,amount_cents,created_at) VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING")
    .bind(id, crypto.randomUUID(), config.handle, order.total_cents, now).run();
  payment = await db().prepare("UPDATE order_payments SET lease_until=? WHERE order_id=? AND checkout_url IS NULL AND lease_until < ? RETURNING *")
    .bind(now + 60000, id, now).first<Payment>();
  if (!payment) {
    const current = await db().prepare("SELECT checkout_url FROM order_payments WHERE order_id=?").bind(id).first<{ checkout_url: string | null }>();
    if (current?.checkout_url) return { url: current.checkout_url, status: order.status };
    throw new AppError("Seu pagamento está sendo preparado. Aguarde alguns segundos e tente novamente.", 409);
  }
  try {
    // A single durable reference is reused on retries; the visitor never supplies price or recipient.
    const url = await createCheckout({ handle: payment.handle, reference: payment.reference, amount: payment.amount_cents, service: order.service, origin: config.origin });
    await db().prepare("UPDATE order_payments SET checkout_url=?,lease_until=0 WHERE order_id=? AND lease_until=?")
      .bind(url, id, now + 60000).run();
    return { url, status: order.status };
  } catch (error) {
    await db().prepare("UPDATE order_payments SET lease_until=0 WHERE order_id=? AND lease_until=?").bind(id, now + 60000).run();
    throw error;
  }
}

export async function confirmProviderPayment(event: PaymentEvent) {
  const payment = await db().prepare("SELECT * FROM order_payments WHERE reference=?").bind(event.order_nsu).first<Payment>();
  if (!payment) throw new AppError("Pagamento não encontrado.", 404);
  // Redirect parameters and webhooks are untrusted. Repeated verified events need no second provider call.
  if (!payment.paid_at || payment.transaction_nsu !== event.transaction_nsu) {
    if (payment.paid_at) throw new AppError("Este pedido já possui outro pagamento confirmado.", 409);
    const checked = await checkPayment(payment.handle, event, payment.amount_cents);
    if (!checked) return { id: payment.order_id, status: "aguardando_pagamento", totalCents: payment.amount_cents };
    const now = Date.now();
    await db().batch([
      db().prepare("UPDATE order_payments SET transaction_nsu=?,invoice_slug=?,capture_method=?,paid_at=? WHERE order_id=? AND paid_at IS NULL")
        .bind(event.transaction_nsu, event.invoice_slug, checked.method, now, payment.order_id),
      db().prepare("UPDATE orders SET status='pago_pronto_envio',paid_at=?,paid_by='InfinitePay' WHERE id=? AND mode='shipping' AND status='aguardando_pagamento' AND EXISTS (SELECT 1 FROM order_payments WHERE order_id=orders.id AND paid_at IS NOT NULL)")
        .bind(now, payment.order_id),
    ]);
  }
  await issueShipment(payment.order_id);
  return { id: payment.order_id, status: "pago_pronto_envio", totalCents: payment.amount_cents };
}
