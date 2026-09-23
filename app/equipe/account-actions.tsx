"use client";
import Link from "next/link";
import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
export default function AccountActions() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error();
      window.location.replace("/equipe/entrar");
    } catch { setError("Não foi possível sair. Tente novamente."); setBusy(false); }
  }
  return <div className="account-actions"><Link className="back-button" href="/equipe/conta"><KeyRound size={16}/> Meu acesso</Link><button className="back-button" onClick={logout} disabled={busy}><LogOut size={16}/>{busy ? "Saindo…" : "Sair"}</button>{error && <p role="alert">{error}</p>}</div>;
}
