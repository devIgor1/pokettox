import { getAdmin } from "./admin-auth";
import { database } from "./pg";
import { z } from "zod";
import { digits, validCpf } from "./domain";
export class AppError extends Error { constructor(message:string, public status=400){ super(message); } }
export function db() { const client=database(); if(!client) throw new AppError("O registro está temporariamente indisponível. Tente novamente.",503); return client; }
export function setting(name:string) { return process.env[name]?.trim() || ""; }
export function shippingConfig() {
  const token=setting("SUPERFRETE_TOKEN"), origin=digits(setting("ORIGIN_CEP")), contact=setting("SUPERFRETE_CONTACT_EMAIL");
  const parcel={weight:Number(setting("PACKAGE_WEIGHT_KG")), height:Number(setting("PACKAGE_HEIGHT_CM")), width:Number(setting("PACKAGE_WIDTH_CM")), length:Number(setting("PACKAGE_LENGTH_CM"))};
  const ready=Boolean(token && origin.length===8 && Object.values(parcel).every(v=>Number.isFinite(v)&&v>0));
  return {token,origin,contact,parcel,ready};
}
export async function requireStaff() {
  const user=await getAdmin();
  if(!user) throw new AppError("Entre com seu e-mail e senha para acessar a equipe.",401);
  return user;
}
export function json(data:unknown,status=200) { return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}}); }
export function failure(error:unknown) {
  if(error instanceof AppError) return json({error:error.message},error.status);
  if(error instanceof z.ZodError) return json({error:error.issues[0]?.message || "Confira os dados informados."},400);
  if(error instanceof SyntaxError) return json({error:"Dados inválidos."},400);
  console.error("Request failed", error instanceof Error ? error.name : "UnknownError");
  return json({error:"Não foi possível concluir agora. Seus dados continuam no formulário. Tente novamente."},503);
}
export async function readBody(req:Request) {
  const origin=req.headers.get("origin");
  if(origin && origin!==new URL(req.url).origin) throw new AppError("Origem da solicitação inválida.",403);
  if(!req.headers.get("content-type")?.includes("application/json")) throw new AppError("Formato inválido.",415);
  const reader=req.body?.getReader(); if(!reader) throw new AppError("Dados ausentes.");
  const decoder=new TextDecoder(); let text="", size=0;
  while(true) { const {value,done}=await reader.read(); if(done)break; size+=value.length; if(size>16384){await reader.cancel();throw new AppError("Solicitação muito grande.",413);} text+=decoder.decode(value,{stream:true}); }
  return JSON.parse(text+decoder.decode());
}
export async function hash(input:string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input)))).map(v=>v.toString(16).padStart(2,"0")).join(""); }
export async function limit(req:Request, action:string, max:number) {
  const window=Math.floor(Date.now()/900000), identity=req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key=await hash(`${identity}:${action}:${window}`);
  const row=await db().prepare("INSERT INTO request_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=request_limits.count+1 RETURNING count").bind(key,(window+1)*900000).first<{count:number}>();
  if(row && row.count>max) throw new AppError("Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",429);
  await db().prepare("DELETE FROM request_limits WHERE expires_at < ?").bind(Date.now()-86400000).run();
}
const required=(label:string)=>z.string().trim().min(1,`Preencha ${label}.`).max(150,"Campo muito longo.");
export const customerSchema=z.object({
  name:required("seu nome").min(3,"Informe seu nome completo."),
  cpf:required("seu CPF").refine(validCpf,"Informe um CPF válido.").transform(digits),
  phone:required("seu telefone").transform(digits).refine(v=>[10,11].includes(v.length),"Informe um telefone com DDD."),
  cep:required("seu CEP").transform(digits).refine(v=>v.length===8,"Informe um CEP válido."),
  street:required("o endereço"),number:required("o número").max(15),complement:z.string().trim().max(150).default(""),
  district:required("o bairro"),city:required("a cidade"),state:z.enum(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"],{errorMap:()=>({message:"Informe uma UF válida."})}),
});
