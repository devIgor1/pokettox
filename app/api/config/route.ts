import { json, setting, shippingConfig } from "@/lib/server";
export async function GET() { return json({shippingReady:shippingConfig().ready,paymentInstructions:setting("PAYMENT_INSTRUCTIONS") || "A equipe entrará em contato pelo telefone informado para orientar o pagamento."}); }
