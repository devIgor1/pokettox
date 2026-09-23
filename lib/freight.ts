import { z } from "zod";
import { totalCents } from "./domain";
import { AppError, shippingConfig } from "./server";
const serviceSchema=z.object({id:z.union([z.string(),z.number()]),name:z.string().optional(),price:z.union([z.string(),z.number()]).nullable().optional(),delivery_time:z.number().nullable().optional(),has_error:z.boolean().optional(),error:z.unknown().optional()}).passthrough();
export function parseServices(input:unknown) { const results=z.array(serviceSchema).parse(input);return results.filter(r=>["1","2"].includes(String(r.id)) && !r.error && !r.has_error && r.price!=null).map(r=>{const cents=Math.round(Number(r.price)*100);if(!Number.isFinite(cents)||cents<=0)throw new AppError("A transportadora retornou um valor inválido.",502);return {id:String(r.id),service:(String(r.id)==="1" ? "PAC" : "SEDEX") as "PAC"|"SEDEX",cents,days:r.delivery_time??null};}); }
export async function calculateFreight(cep:string,declaredValue:number) {
  const config=shippingConfig(); if(!config.ready)throw new AppError("O frete ainda não foi configurado pela loja. Suas cartas podem ser guardadas no cofre enquanto isso.",503);
  const request=async(insured:boolean)=>{
    const response=await fetch("https://api.superfrete.com/api/v0/calculator",{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"User-Agent":`PokeCofre/1.0 (${config.contact})`,Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({from:{postal_code:config.origin},to:{postal_code:cep},services:"1,2",options:{own_hand:false,receipt:false,insurance_value:insured?declaredValue:0,use_insurance_value:insured},package:config.parcel}),signal:AbortSignal.timeout(18000)});
    if(!response.ok)throw new AppError("Não foi possível consultar a transportadora agora. Tente novamente.",502);
    return parseServices(await response.json());
  };
  const [base,insured]=await Promise.all([request(false),request(true)]);
  const result=base.flatMap(b=>{const secured=insured.find(s=>s.id===b.id);if(!secured)return [];const insurance=secured.cents-b.cents;if(insurance<0)throw new AppError("A cotação do seguro mudou. Tente calcular novamente.",502);return [{service:b.service,days:secured.days,baseCents:b.cents,insuranceCents:insurance,totalCents:totalCents(b.cents,insurance)}];});
  if(!result.length)throw new AppError("PAC e SEDEX não estão disponíveis para este endereço e pacote.",422);
  return result;
}
