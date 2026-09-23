import { z } from "zod";
import { db, failure, json, limit, readBody } from "@/lib/server";
import { calculateFreight } from "@/lib/freight";
export async function POST(req:Request) { try {
  const data=z.object({cep:z.string().regex(/^\d{8}$/, "Informe um CEP válido."),declaredValue:z.number().finite().positive("Informe o valor das cartas.").max(1000000,"Confira o valor declarado.")}).parse(await readBody(req));
  await limit(req,"quotes",20);
  const result=await calculateFreight(data.cep,data.declaredValue);
  const existing=req.headers.get("cookie")?.match(/(?:^|;\s*)pc_quote=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const owner=existing || crypto.randomUUID(), expires=Date.now()+15*60*1000;
  const quotes=result.map(q=>({...q,id:crypto.randomUUID()}));
  await db().batch(quotes.map(q=>db().prepare("INSERT INTO quotes (id,owner,cep,service,days,base_cents,insurance_cents,total_cents,declared_cents,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(q.id,owner,data.cep,q.service,q.days,q.baseCents,q.insuranceCents,q.totalCents,Math.round(data.declaredValue*100),expires)));
  await db().prepare("DELETE FROM quotes WHERE expires_at < ? AND id NOT IN (SELECT quote_id FROM orders WHERE quote_id IS NOT NULL)").bind(Date.now()-86400000).run();
  const response=json({quotes,expiresAt:expires});response.headers.set("Set-Cookie",`pc_quote=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${new URL(req.url).protocol==="https:"?"; Secure":""}`);return response;
} catch(e) { return failure(e); } }
