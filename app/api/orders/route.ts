import { z } from "zod";
import { AppError, customerSchema, db, failure, hash, json, limit, readBody } from "@/lib/server";
import { prepareShipment } from "@/lib/shipments";
export async function POST(req:Request) { try {
  const payload=z.object({customer:customerSchema,mode:z.enum(["vault","shipping"]),quoteId:z.string().uuid().optional()}).parse(await readBody(req));
  const key=z.string().uuid("Identificação da solicitação inválida.").parse(req.headers.get("idempotency-key"));
  const fingerprint=await hash(JSON.stringify(payload));
  const previous=await db().prepare("SELECT id,status,fingerprint FROM orders WHERE idempotency_key=?").bind(key).first<{id:string;status:string;fingerprint:string}>();
  if(previous){if(previous.fingerprint!==fingerprint)throw new AppError("A solicitação mudou. Atualize a página para iniciar outra.",409);await prepareShipment(previous.id);return json({id:previous.id,status:previous.status});}
  await limit(req,"orders",12);
  let quote:{id:string;service:string;total_cents:number}|null=null;
  if(payload.mode==="shipping") {
    const owner=req.headers.get("cookie")?.match(/(?:^|;\s*)pc_quote=([a-f0-9-]{36})(?:;|$)/)?.[1];
    if(!owner || !payload.quoteId)throw new AppError("Calcule e selecione o frete primeiro.");
    quote=await db().prepare("SELECT id,service,total_cents FROM quotes WHERE id=? AND owner=? AND cep=? AND expires_at>?").bind(payload.quoteId,owner,payload.customer.cep,Date.now()).first();
    if(!quote)throw new AppError("A cotação expirou ou o CEP mudou. Volte e calcule o frete novamente.",409);
    const used=await db().prepare("SELECT id FROM orders WHERE quote_id=?").bind(quote.id).first();
    if(used)throw new AppError("Esta cotação já foi usada. Calcule um novo frete.",409);
  }
  const id=`PC-${crypto.randomUUID().toUpperCase()}`,status=payload.mode==="vault"?"no_cofre":"aguardando_pagamento";
  await db().prepare("INSERT INTO orders (id,idempotency_key,fingerprint,customer,mode,service,quote_id,total_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").bind(id,key,fingerprint,JSON.stringify(payload.customer),payload.mode,quote?.service??null,quote?.id??null,quote?.total_cents??null,status,Date.now()).run();
  const saved=await db().prepare("SELECT id,status,fingerprint FROM orders WHERE idempotency_key=?").bind(key).first<{id:string;status:string;fingerprint:string}>();
  if(!saved || saved.fingerprint!==fingerprint)throw new AppError("Solicitação duplicada ou alterada. Confira os dados.",409);
  await prepareShipment(saved.id);
  return json({id:saved.id,status:saved.status},201);
}catch(e){return failure(e);} }
