"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { ArrowLeft,Check,CircleAlert,CircleCheck,Clock3,Database,Download,FileText,LoaderCircle,RefreshCw,ShieldCheck,Vault } from "lucide-react";
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from "@/components/ui/table";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from "@/components/ui/dialog";
import { Tabs,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { money,type Customer } from "@/lib/domain";
import AccountActions from "./account-actions";
type Order={id:string;customer:Customer;mode:string;service:string|null;total_cents:number|null;status:string;created_at:number;paid_at:number|null;paid_by:string|null;capture_method:string|null;shipment_status:string|null;superfrete_id:string|null;tracking:string|null;print_url:string|null;shipment_error:string|null};
const labels:Record<string,string>={no_cofre:"No cofre",aguardando_pagamento:"Aguardando pagamento",pago_pronto_envio:"Pago / pronto para envio"};
function ShipmentStatus({order,busy,onRetry}:{order:Order;busy:boolean;onRetry:(id:string)=>void}){
  if(!order.shipment_status)return <span className="shipment-registered"><Check size={16} aria-hidden="true"/> Registrado</span>;
  const issued=order.shipment_status==="issued";
  const attention=order.shipment_status==="attention"||order.shipment_status==="creating";
  const Icon=issued?CircleCheck:attention?CircleAlert:Clock3;
  return <div className={`shipment-status ${issued?"shipment-issued":attention?"shipment-attention":"shipment-pending"}`}>
    <div className="shipment-heading"><Icon size={18} aria-hidden="true"/><strong>{issued?"Etiqueta emitida":attention?"Conferir etiqueta":"Etiqueta pendente"}</strong></div>
    {issued?<>
      {order.tracking&&<div className="shipment-reference"><span>Rastreio</span><code>{order.tracking}</code></div>}
      {order.print_url&&<a className="secondary-button shipment-action" href={order.print_url} target="_blank" rel="noopener noreferrer"><FileText size={16} aria-hidden="true"/> Abrir etiqueta</a>}
    </>:<>
      {order.shipment_error&&<p className="shipment-message">{order.shipment_error}</p>}
      {order.superfrete_id&&<div className="shipment-reference"><span>Pedido SuperFrete</span><code>{order.superfrete_id}</code></div>}
      <div className="shipment-actions">
        {(order.superfrete_id||order.shipment_status==="waiting_payment")&&<button className="primary-button shipment-action" disabled={busy} onClick={()=>onRetry(order.id)}>{busy?<LoaderCircle size={16} className="spin" aria-hidden="true"/>:<RefreshCw size={16} aria-hidden="true"/>}Verificar e emitir etiqueta</button>}
        <a className="text-button shipment-link" href="https://web.superfrete.com/" target="_blank" rel="noopener noreferrer">Abrir SuperFrete</a>
      </div>
    </>}
  </div>;
}
export default function Staff(){
  const [storageBytes,setStorageBytes]=useState<number|null>(null);
  const [orders,setOrders]=useState<Order[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[filter,setFilter]=useState("all"),[confirm,setConfirm]=useState<Order|null>(null),[cursor,setCursor]=useState<number|null>(null),[ready,setReady]=useState(false),[authorized,setAuthorized]=useState(false);
  const load=useCallback(async(before?:number)=>{setLoading(true);setError("");try{const res=await fetch(`/api/staff/orders${before?`?before=${before}`:""}`);const data=await res.json() as {error?:string;orders:Order[];nextCursor:number|null;shippingReady:boolean;storageBytes:number|null};if(!res.ok)throw new Error(data.error);setAuthorized(true);setOrders(prev=>before?[...prev,...data.orders]:data.orders);setCursor(data.nextCursor);setReady(data.shippingReady);setStorageBytes(typeof data.storageBytes==="number"&&Number.isFinite(data.storageBytes)&&data.storageBytes>=0?data.storageBytes:null);}catch(e){setError(e instanceof Error?e.message:"Não foi possível carregar.");}finally{setLoading(false);}},[]);
  useEffect(()=>{const task=setTimeout(()=>void load(),0);return ()=>clearTimeout(task);},[load]);
  async function paid(){if(!confirm||busy)return;setBusy(true);setError("");try{const res=await fetch("/api/staff/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:confirm.id,action:"confirm_payment"})});const data=await res.json() as {error?:string};if(!res.ok)throw new Error(data.error);setConfirm(null);await load();}catch(e){setError(e instanceof Error?e.message:"Falha ao confirmar.");}finally{setBusy(false);}}
  async function retryLabel(id:string){setBusy(true);setError("");try{const res=await fetch("/api/staff/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,action:"retry_label"})});const data=await res.json() as {error?:string};if(!res.ok)throw new Error(data.error);await load();}catch(e){setError(e instanceof Error?e.message:"Não foi possível verificar a etiqueta.");}finally{setBusy(false);}}
  const visible=orders.filter(o=>filter==="all"||o.status===filter);
  return <><div className="color-ribbon"/><main className="staff-shell"><div className="staff-navigation"><Link className="back-button" href="/"><ArrowLeft size={17}/> Voltar ao formulário</Link><AccountActions/></div><div className="page-intro" style={{marginTop:30}}><div><div className="eyebrow"><ShieldCheck size={15}/> ÁREA DA EQUIPE</div><h1>Uma coleção bem <span>organizada.</span></h1><p>Acompanhe pagamentos e etiquetas. A InfinitePay confirma os recebimentos automaticamente.</p></div><Vault size={45} color="#d4a629"/></div>{error&&<p className="error-box" role="alert">{error}</p>}{authorized&&<>
  {!ready&&<details className="staff-settings"><summary>Falta configurar o SuperFrete</summary><p>A cotação será liberada depois de configurar o token, o CEP de origem e o peso e as dimensões da embalagem. O seguro usa o valor declarado das cartas e a tarifa da transportadora.</p><p>Os registros do cofre já podem ser usados. Nenhum preço fictício será apresentado ao cliente.</p></details>}
  <div className="staff-toolbar"><Tabs value={filter} onValueChange={setFilter}><TabsList className="h-auto flex-wrap"><TabsTrigger value="all">Todos</TabsTrigger><TabsTrigger value="no_cofre">Cofre</TabsTrigger><TabsTrigger value="aguardando_pagamento">Aguardando</TabsTrigger><TabsTrigger value="pago_pronto_envio">Prontos para envio</TabsTrigger></TabsList></Tabs><div style={{display:"flex",gap:15}}><button className="back-button" onClick={()=>load()} disabled={loading} aria-label="Atualizar pedidos"><RefreshCw size={17} className={loading?"spin":""}/></button><a className="primary-button" href="/api/staff/spreadsheet"><Download size={17}/> Planilha de pagos</a></div></div>
  <div className="staff-table"><Table>
    <TableHeader><TableRow><TableHead className="staff-customer-column">Cliente</TableHead><TableHead className="staff-phone-column">Telefone</TableHead><TableHead className="staff-mode-column">Modalidade</TableHead><TableHead className="staff-value-column">Valor</TableHead><TableHead className="staff-status-column">Status</TableHead><TableHead className="staff-shipment-column">Ação / etiqueta</TableHead></TableRow></TableHeader>
    <TableBody>{visible.map(o=><TableRow key={o.id}>
      <TableCell><strong>{o.customer.name}</strong><small>{new Date(o.created_at).toLocaleDateString("pt-BR")}</small><details><summary className="text-button">Ver dados</summary><p style={{fontSize:12,lineHeight:1.8,marginTop:8}}>CPF: {o.customer.cpf}<br/>{o.customer.street}, {o.customer.number}<br/>{o.customer.complement}<br/>{o.customer.district} · {o.customer.city}/{o.customer.state}<br/>CEP: {o.customer.cep}<br/>{o.id}</p></details></TableCell>
      <TableCell className="staff-nowrap">{o.customer.phone}</TableCell><TableCell>{o.service||"Cofre"}</TableCell><TableCell className="staff-nowrap">{o.total_cents!==null?money(o.total_cents):"—"}</TableCell>
      <TableCell><span className="choice-tag blue-tag">{labels[o.status]}</span>{o.paid_by==="InfinitePay"&&<small>InfinitePay · {o.capture_method==="pix"?"PIX":"Cartão"}</small>}</TableCell>
      <TableCell>{o.status==="aguardando_pagamento"?<button className="primary-button staff-confirm-button" onClick={()=>setConfirm(o)}><Check size={16}/> Confirmar pagamento</button>:<ShipmentStatus order={o} busy={busy} onRetry={retryLabel}/>}</TableCell>
    </TableRow>)}</TableBody>
  </Table>{!visible.length&&<p className="staff-empty">{loading?"Carregando solicitações…":"Nenhuma solicitação nesta categoria."}</p>}</div>{cursor&&<button className="secondary-button" style={{marginTop:20}} disabled={loading} onClick={()=>load(cursor)}>Carregar mais</button>}<p className="input-note">A planilha inclui todos os pedidos pagos e prontos para envio, com nome, telefone, PAC ou SEDEX e status. Compatível com Excel e Google Sheets.</p></>}{loading&&!authorized&&<p className="input-note">Carregando…</p>}
  {authorized&&<details className="staff-storage"><summary><Database size={17} aria-hidden="true"/><span>Armazenamento do banco</span></summary><div className="staff-storage-content">{storageBytes!==null?<><strong>{(storageBytes/1_000_000).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})} MB usados</strong><span>{storageBytes.toLocaleString("pt-BR")} bytes · Medido ao carregar os pedidos.</span></>:<p>A medição não está disponível neste momento. Atualize os pedidos para tentar novamente.</p>}<p>Banco Postgres no Neon. O limite de armazenamento depende do plano contratado no Neon.</p></div></details>}
  <Dialog open={!!confirm} onOpenChange={open=>{if(!open&&!busy)setConfirm(null);}}><DialogContent className="information-dialog"><DialogHeader><DialogTitle>O pagamento foi recebido?</DialogTitle><DialogDescription>Confira o recebimento de {confirm?.total_cents!=null?money(confirm.total_cents):""} de {confirm?.customer.name}. Esta ação libera o pedido e o inclui na planilha de pagos.</DialogDescription></DialogHeader>{error&&<p className="error-box">{error}</p>}<button className="primary-button" disabled={busy} onClick={paid}>{busy?<LoaderCircle className="spin" size={18}/>:<Check size={18}/>} Recebimento conferido, confirmar</button></DialogContent></Dialog></main></>;
}



