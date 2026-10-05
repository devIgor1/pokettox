import { z } from "zod";

const api = "https://api.checkout.infinitepay.io";
export const paymentEventSchema = z.object({
  order_nsu: z.string().uuid(),
  transaction_nsu: z.string().min(1).max(200),
  invoice_slug: z.string().min(1).max(200),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export class PaymentProviderError extends Error {}

async function request(path: string, body: object) {
  const response = await fetch(`${api}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: "error",
  });
  if (!response.ok) throw new PaymentProviderError("A InfinitePay está indisponível. Tente novamente em instantes.");
  // Bound responses without logging provider payloads or customer details.
  const reader = response.body?.getReader();
  if (!reader) throw new PaymentProviderError("Resposta de pagamento inválida.");
  let size = 0, content = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); throw new PaymentProviderError("Resposta de pagamento inválida."); }
    content += decoder.decode(value, { stream: true });
  }
  return JSON.parse(content + decoder.decode()) as unknown;
}

export function checkoutUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    !(url.hostname === "infinitepay.io" || url.hostname.endsWith(".infinitepay.io"))) {
    throw new PaymentProviderError("O endereço de pagamento retornado é inválido.");
  }
  return url.href;
}

export async function createCheckout(input: { handle: string; reference: string; amount: number; service: string; origin: string }) {
  const result = z.object({ url: z.string().url() }).parse(await request("links", {
    handle: input.handle, order_nsu: input.reference,
    items: [{ quantity: 1, price: input.amount, description: `Envio de cartas ${input.service} com seguro e preparação` }],
    redirect_url: `${input.origin}/pagamento`,
    webhook_url: `${input.origin}/api/payments/webhook`,
  }));
  return checkoutUrl(result.url);
}

export async function checkPayment(handle: string, event: PaymentEvent, expectedAmount: number) {
  const result = z.object({
    success: z.boolean(), paid: z.boolean(),
    amount: z.number().int().optional(), paid_amount: z.number().int().optional(),
    capture_method: z.enum(["pix", "credit_card"]).optional(),
  }).parse(await request("payment_check", {
    handle, order_nsu: event.order_nsu, transaction_nsu: event.transaction_nsu, slug: event.invoice_slug,
  }));
  if (!result.success || !result.paid) return null;
  if (result.amount !== expectedAmount || !result.paid_amount || result.paid_amount < expectedAmount || !result.capture_method) {
    throw new PaymentProviderError("O valor do pagamento não corresponde ao pedido. A equipe precisa conferir o recebimento.");
  }
  return { method: result.capture_method };
}
