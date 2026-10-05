import { json, setting, shippingConfig } from "@/lib/server";
import { paymentConfig } from "@/lib/payments";
export async function GET() { return json({shippingReady:shippingConfig().ready,paymentReady:paymentConfig().ready,paymentInstructions:setting("PAYMENT_INSTRUCTIONS") || "A equipe entrará em contato pelo telefone informado para orientar o pagamento."}); }
