"use client";
import { useEffect, useState } from "react";
import { CreditCard, QrCode, ShieldCheck, LoaderCircle, CheckCircle2 } from "lucide-react";

export default function PaymentPanel({ id, accessKey, onPaid }: { id: string; accessKey: string; onPaid: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let alive = true, count = 0;
    const timer = setInterval(async () => {
      if (++count > 90) { clearInterval(timer); return; }
      if (document.hidden) return;
      try {
        const res = await fetch("/api/payments/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, key: accessKey }) });
        const data = await res.json() as { status?: string };
        if (alive && res.ok && data.status === "pago_pronto_envio") { clearInterval(timer); onPaid(); }
      } catch { /* Payment can still be completed if this optional status refresh fails. */ }
    }, 10000);
    return () => { alive = false; clearInterval(timer); };
  }, [id, accessKey, onPaid]);
  async function pay() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, key: accessKey }) });
      const data = await res.json() as { url?: string; status?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Não foi possível abrir o pagamento.");
      if (data.status === "pago_pronto_envio") { onPaid(); return; }
      if (!data.url) throw new Error("Não foi possível abrir o pagamento.");
      window.location.assign(data.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); }
    finally { setBusy(false); }
  }
  return <div className="payment-panel">
    <h3>Como você prefere pagar?</h3>
    <p>Escolha PIX ou cartão na página segura da InfinitePay.</p>
    <div className="payment-methods">
      <div><QrCode size={25}/><strong>PIX</strong><span>QR Code ou copia e cola</span></div>
      <div><CreditCard size={25}/><strong>Cartão de crédito</strong><span>Pagamento pela InfinitePay</span></div>
    </div>
    {error && <p className="error-box" role="alert">{error}</p>}
    <button className="primary-button" disabled={busy} onClick={pay}>{busy ? <LoaderCircle size={19} className="spin"/> : <ShieldCheck size={19}/>} {busy ? "Preparando pagamento…" : "Pagar com PIX ou cartão"}</button>
    <p className="payment-note"><CheckCircle2 size={16}/> Confirmação automática após a aprovação.</p>
  </div>;
}
