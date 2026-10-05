import { z } from "zod";
import { AppError, db, failure, json, readBody, requireStaff, shippingConfig } from "@/lib/server";
import { issueShipment, shipmentConfig } from "@/lib/shipments";
import { paymentConfig } from "@/lib/payments";
export async function GET(req:Request) { try {
  await requireStaff();
  const cursor=Number(new URL(req.url).searchParams.get("before")||Date.now()+1);
  if(!Number.isFinite(cursor))throw new AppError("Página inválida.");
  const {results}=await db().prepare("SELECT o.id,o.customer,o.mode,o.service,o.total_cents,o.status,o.created_at,o.paid_at,o.paid_by,p.capture_method,s.status AS shipment_status,s.superfrete_id,s.tracking,s.print_url,s.error AS shipment_error FROM orders o LEFT JOIN order_payments p ON p.order_id=o.id LEFT JOIN shipment_jobs s ON s.order_id=o.id WHERE o.created_at < ? ORDER BY o.created_at DESC LIMIT 101").bind(cursor).all<{id:string;customer:string;mode:string;service:string|null;total_cents:number|null;status:string;created_at:number;paid_at:number|null}>();
  const rows=results.slice(0,100).map(row=>({...row,customer:JSON.parse(row.customer)}));
  return json({orders:rows,nextCursor:results.length>100?rows.at(-1)?.created_at:null,shippingReady:shippingConfig().ready,paymentReady:paymentConfig().ready,autoLabelReady:shipmentConfig().ready});
}catch(e){return failure(e);} }
export async function POST(req:Request) { try {
  const user=await requireStaff();
  const {id,action}=z.object({id:z.string().max(60),action:z.enum(["confirm_payment","retry_label"])}).parse(await readBody(req));
  if(action==="retry_label") {
    const paid=await db().prepare("SELECT id FROM orders WHERE id=? AND status='pago_pronto_envio'").bind(id).first();
    if(!paid)throw new AppError("Confirme o pagamento antes de emitir a etiqueta.",409);
    await issueShipment(id,true);
    return json({id});
  }
  if(action!=="confirm_payment")throw new AppError("Ação inválida.");
  const result=await db().prepare("UPDATE orders SET status='pago_pronto_envio',paid_at=?,paid_by=? WHERE id=? AND mode='shipping' AND status='aguardando_pagamento' RETURNING id,status").bind(Date.now(),user.email,id).first();
  if(result){await issueShipment(id);return json(result);}
  const current=await db().prepare("SELECT id,status,mode FROM orders WHERE id=?").bind(id).first<{id:string;status:string;mode:string}>();
  if(current?.status==="pago_pronto_envio" && current.mode==="shipping")return json({id:current.id,status:current.status});
  throw new AppError("Somente pedidos de envio aguardando pagamento podem ser confirmados.",409);
}catch(e){return failure(e);} }
