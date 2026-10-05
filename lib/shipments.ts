import { z } from "zod";
import { AppError, db, setting, shippingConfig } from "./server";
import { type Customer } from "./domain";

type Shipment = { order_id: string; request_json: string; max_cents: number; status: string; superfrete_id: string | null; lease_until: number };
const addressSchema = z.object({
  name: z.string().min(3).max(50), address: z.string().min(1).max(50), number: z.string().max(10),
  district: z.string().min(1).max(50), city: z.string().min(1).max(50), state_abbr: z.string().length(2),
  postal_code: z.string().length(8), complement: z.string().max(20).optional(), document: z.string().optional(),
});
export function shipmentConfig() {
  const shipping = shippingConfig();
  const from = { name: setting("SENDER_NAME"), address: setting("SENDER_STREET"), number: setting("SENDER_NUMBER"),
    district: setting("SENDER_DISTRICT"), city: setting("SENDER_CITY"), state_abbr: setting("SENDER_STATE"), postal_code: shipping.origin };
  return { from, ready: shipping.ready && setting("SUPERFRETE_AUTO_LABEL") === "true" && setting("SHIPPING_DOCUMENT") === "declaration" && addressSchema.safeParse(from).success };
}

export async function prepareShipment(orderId: string) {
  const config = shipmentConfig();
  if (!config.ready) return;
  const order = await db().prepare("SELECT o.customer,o.service,q.declared_cents,q.base_cents,q.insurance_cents FROM orders o JOIN quotes q ON q.id=o.quote_id WHERE o.id=? AND o.mode='shipping'")
    .bind(orderId).first<{ customer: string; service: string; declared_cents: number; base_cents: number; insurance_cents: number }>();
  if (!order) return;
  const customer = JSON.parse(order.customer) as Customer;
  const to = { name: customer.name, address: customer.street, number: customer.number, complement: customer.complement,
    district: customer.district, city: customer.city, state_abbr: customer.state, postal_code: customer.cep, document: customer.cpf };
  const valid = addressSchema.safeParse(to).success;
  const payload = { from: config.from, to, service: order.service === "PAC" ? 1 : 2,
    products: [{ name: "Lote de cartas colecionáveis", quantity: 1, unitary_value: order.declared_cents / 100 }],
    volumes: shippingConfig().parcel, options: { insurance_value: order.declared_cents / 100, own_hand: false, receipt: false,
      non_commercial: true, tags: [{ tag: orderId, url: setting("PUBLIC_SITE_URL") }] }, platform: "PokeCofre" };
  await db().prepare("INSERT INTO shipment_jobs (order_id,request_json,max_cents,status,error,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING")
    .bind(orderId, JSON.stringify(payload), order.base_cents + order.insurance_cents, valid ? "waiting_payment" : "attention",
      valid ? null : "Confira os dados no painel SuperFrete: nome/endereço/bairro/cidade até 50 caracteres, número até 10 e complemento até 20.", Date.now()).run();
}

class FreightResponseError extends Error {}
async function freightRequest(path: string, body?: unknown) {
  const config = shippingConfig();
  const response = await fetch(`https://api.superfrete.com/api/v0/${path}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json",
      Accept: "application/json", "User-Agent": `PokeCofre/1.0 (${config.contact || setting("PUBLIC_SITE_URL")})` },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000), redirect: "manual",
  });
  if (!response.ok) throw new FreightResponseError("Confira o saldo, os limites e os dados da etiqueta no painel SuperFrete.");
  const reader = response.body?.getReader(); if (!reader) throw new Error("Missing response");
  let content = "", size = 0; const decoder = new TextDecoder();
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > 131072) { await reader.cancel(); throw new Error("Response too large"); } content += decoder.decode(value, { stream: true }); }
  return JSON.parse(content + decoder.decode()) as unknown;
}

const infoSchema = z.object({ id: z.string().min(1), price: z.coerce.number().positive(), status: z.string(),
  tracking: z.string().nullable().optional(), print: z.object({ url: z.string().optional() }).nullable().optional() });
function safePrint(value?: string) { try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; } }

export async function issueShipment(orderId: string, retry = false) {
  if (!shipmentConfig().ready) return;
  const now = Date.now();
  const job = await db().prepare(`UPDATE shipment_jobs SET lease_until=?,updated_at=? WHERE order_id=? AND lease_until < ?
    AND (status='waiting_payment' OR (status='attention' AND superfrete_id IS NOT NULL AND ?=1))
    AND EXISTS (SELECT 1 FROM orders WHERE id=shipment_jobs.order_id AND status='pago_pronto_envio') RETURNING *`)
    .bind(now + 90000, now, orderId, now, retry ? 1 : 0).first<Shipment>();
  if (!job) return;
  let labelId = job.superfrete_id;
  try {
    if (!labelId) {
      // Persist before the external mutation. Unknown outcomes require reconciliation, never a second cart.
      await db().prepare("UPDATE shipment_jobs SET status='creating' WHERE order_id=?").bind(orderId).run();
      const created = infoSchema.parse(await freightRequest("cart", JSON.parse(job.request_json)));
      labelId = created.id;
      await db().prepare("UPDATE shipment_jobs SET superfrete_id=?,status='attention' WHERE order_id=?").bind(labelId, orderId).run();
    }
    // Reconcile status before every purchase attempt, including a staff retry after a timeout.
    let info = infoSchema.parse(await freightRequest(`order/info/${encodeURIComponent(labelId)}`));
    if (info.id !== labelId) throw new Error("Wrong label returned");
    if (info.status === "pending") {
      const cents = Math.round(info.price * 100);
      if (!Number.isSafeInteger(cents) || cents > job.max_cents) throw new AppError("O frete aumentou desde a cotação. Confira a etiqueta na SuperFrete antes de pagar a diferença.");
      await freightRequest("checkout", { orders: [labelId] });
      info = infoSchema.parse(await freightRequest(`order/info/${encodeURIComponent(labelId)}`));
    }
    if (info.id !== labelId || !["released", "posted", "delivered"].includes(info.status)) throw new AppError("A etiqueta ainda não foi liberada. Confira o saldo e o pedido na SuperFrete.");
    await db().prepare("UPDATE shipment_jobs SET status='issued',tracking=?,print_url=?,error=NULL,lease_until=0,updated_at=? WHERE order_id=?")
      .bind(info.tracking || null, safePrint(info.print?.url), Date.now(), orderId).run();
  } catch (error) {
    const message = labelId ? (error instanceof AppError || error instanceof FreightResponseError ? error.message : "Não foi possível confirmar a emissão. Consulte a etiqueta existente antes de tentar novamente.")
      : "A criação da etiqueta não foi confirmada. Localize o pedido pelo protocolo no painel SuperFrete antes de qualquer nova emissão.";
    await db().prepare("UPDATE shipment_jobs SET status='attention',error=?,lease_until=0,updated_at=? WHERE order_id=?")
      .bind(message, Date.now(), orderId).run();
  }
}
