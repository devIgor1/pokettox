import { AppError, failure, json } from "@/lib/server";
export async function GET(req:Request) { try {
  const cep=new URL(req.url).searchParams.get("cep"); if(!cep || !/^\d{8}$/.test(cep)) throw new AppError("CEP inválido.");
  const res=await fetch(`https://viacep.com.br/ws/${cep}/json/`,{signal:AbortSignal.timeout(6000)});
  if(!res.ok)throw new AppError("Preencha o endereço manualmente.",502);
  const data=await res.json() as Record<string,string>;
  if(data.erro)throw new AppError("CEP não encontrado. Confira ou preencha manualmente.",404);
  return json({logradouro:data.logradouro,bairro:data.bairro,localidade:data.localidade,uf:data.uf});
}catch(e){return failure(e);} }
