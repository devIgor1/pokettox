import { z } from "zod";
import { AppError, failure, json, limit, readBody } from "@/lib/server";
import { PaymentProviderError, paymentEventSchema } from "@/lib/infinitepay";
import { confirmProviderPayment, orderAccessSchema, ownedOrder, startCheckout } from "@/lib/payments";

export async function POST(req: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  try {
    if (!["checkout", "status", "return", "webhook"].includes(action)) throw new AppError("Página não encontrada.", 404);
    if (action !== "webhook") {
      if (req.headers.get("origin") !== new URL(req.url).origin) throw new AppError("Origem inválida.", 403);
      await limit(req, `payment-${action}`, action === "status" ? 180 : 30);
    }
    const body = await readBody(req);
    if (action === "checkout" || action === "status") {
      const { id, key } = orderAccessSchema.parse(body);
      if (action === "checkout") return json(await startCheckout(id, key));
      const order = await ownedOrder(id, key);
      return json({ id: order.id, status: order.status, totalCents: order.total_cents });
    }
    const result = await confirmProviderPayment(paymentEventSchema.parse(body));
    if (action === "webhook") {
      if (result.status !== "pago_pronto_envio") return json({ success: false, message: "Pagamento ainda não confirmado." }, 400);
      return json({ success: true, message: null });
    }
    return json(result);
  } catch (error) {
    // InfinitePay documents 400 as retryable. Do not expose account or transaction details to callbacks.
    if (action === "webhook") return json({ success: false, message: "Não foi possível validar o pagamento." }, 400);
    if (error instanceof PaymentProviderError) return json({ error: error.message }, 502);
    if (error instanceof z.ZodError) return json({ error: "Dados de pagamento inválidos." }, 400);
    return failure(error);
  }
}
