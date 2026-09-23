import { db, failure, requireStaff } from "@/lib/server";
import { paidCsv } from "@/lib/csv";
import type { Customer } from "@/lib/domain";
export async function GET() { try {
  await requireStaff();
  const {results}=await db().prepare("SELECT customer,service FROM orders WHERE status='pago_pronto_envio' AND mode='shipping' AND service IN ('PAC','SEDEX') ORDER BY paid_at ASC").all<{customer:string;service:string}>();
  const rows=results.map(r=>{const c=JSON.parse(r.customer) as Customer;return {name:c.name,phone:c.phone,service:r.service};});
  return new Response(paidCsv(rows),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="pedidos-pagos-prontos-para-envio.csv"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}catch(e){return failure(e);} }
