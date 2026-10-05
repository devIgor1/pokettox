"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, Vault, RefreshCw } from "lucide-react";
import { money } from "@/lib/domain";

export default function PaymentReturn() {
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; status: string; totalCents: number } | null>(null);
  const event = useRef<{ order_nsu: string; invoice_slug: string; transaction_nsu: string } | null>(null);
  const started = useRef(false);
  async function verify() {
    if (!event.current) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payments/return", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event.current) });
      const data = await response.json() as { id: string; status: string; totalCents: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível conferir o pagamento agora.");
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (started.current) return; started.current = true;
    const query = new URLSearchParams(window.location.search);
    const order_nsu = query.get("order_nsu"), invoice_slug = query.get("slug"), transaction_nsu = query.get("transaction_nsu");
    window.history.replaceState(null, "", window.location.pathname);
    if (!order_nsu || !invoice_slug || !transaction_nsu) { setBusy(false); setError("Abra esta página pelo botão Continuar da InfinitePay após o pagamento. Se você já pagou, a equipe também recebe a confirmação automática."); return; }
    event.current = { order_nsu, invoice_slug, transaction_nsu }; void verify();
  }, []);
  const paid = result?.status === "pago_pronto_envio";
  return <><div className="color-ribbon"/><main className="auth-shell payment-return"><Link href="/" className="brand auth-brand"><span className="brand-icon"><Vault size={25}/></span><span>poké<span className="brand-blue">cofre</span></span></Link><section className="auth-card">
    <span className="auth-symbol">{busy ? <LoaderCircle className="spin" size={27}/> : paid ? <CheckCircle2 size={27}/> : <RefreshCw size={27}/>}</span>
    <h1>{busy ? "Conferindo seu pagamento…" : paid ? "Pagamento confirmado!" : "Confira seu pagamento"}</h1>
    <p>{paid ? "Tudo certo! A equipe recebeu a confirmação e vai preparar suas cartas para envio." : "A confirmação depende da aprovação na InfinitePay."}</p>
    {result && <div className="protocol"><small>NÚMERO DA SOLICITAÇÃO</small><strong>{result.id}</strong><b>{money(result.totalCents)}</b><span className="choice-tag">{paid ? "Pago / pronto para envio" : "Aguardando aprovação"}</span></div>}
    {error && <p className="error-box" role="alert">{error}</p>}
    {!busy && !paid && event.current && <button className="primary-button auth-submit" onClick={verify}>Verificar novamente</button>}
    <Link href="/" className="back-button" style={{ marginTop: 25 }}>Voltar ao início</Link>
  </section></main></>;
}
