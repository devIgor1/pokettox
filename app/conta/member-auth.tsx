"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound, Vault } from "lucide-react";

type Mode = "login" | "signup";
export function PasswordField({ label, name, newPassword = false }: { label: string; name: string; newPassword?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <label className="field auth-field">{label}<span className="password-input">
    <input name={name} type={visible ? "text" : "password"} autoComplete={newPassword ? "new-password" : "current-password"} required minLength={newPassword ? 10 : 1} maxLength={128}/>
    <button type="button" aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={19}/> : <Eye size={19}/>}</button>
  </span></label>;
}
const content = {
  login: { title: "Entre na sua conta.", description: "Veja seu cofre, seus pagamentos e peça o envio das suas cartas.", button: "Entrar" },
  signup: { title: "Crie sua conta.", description: "Use o mesmo WhatsApp com que você participa do grupo de leilões.", button: "Criar conta" },
};
export default function MemberAuth({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const copy = content[mode];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    if (mode === "signup" && password !== String(data.get("confirmPassword") || "")) { setError("As senhas não coincidem. Confira os dois campos."); return; }
    setBusy(true); setError("");
    try {
      const payload = mode === "login"
        ? { email: data.get("email"), password }
        : { name: data.get("name"), email: data.get("email"), phone: data.get("phone"), password, acceptTerms: data.get("acceptTerms") === "on" };
      const response = await fetch(`/api/account/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível continuar agora.");
      router.replace("/conta");
    } catch (e) { setError(e instanceof Error ? e.message : "Tente novamente em instantes."); setBusy(false); }
  }
  return <><div className="color-ribbon"/><main className="auth-shell">
    <Link href="/" className="back-button"><ArrowLeft size={17}/> Voltar ao início</Link>
    <div className="auth-card">
      <div className="auth-brand"><span className="brand-icon"><Vault size={27}/></span><span>Poké<span className="brand-blue">Cofre</span></span></div>
      <div className="eyebrow"><UserRound size={15}/> MINHA CONTA</div>
      <h1>{copy.title}</h1><p className="auth-description">{copy.description}</p>
      <form onSubmit={submit} className="auth-form">
        {mode === "signup" && <label className="field auth-field">Nome completo<input name="name" autoComplete="name" required minLength={3} maxLength={150}/></label>}
        <label className="field auth-field">E-mail<input name="email" type="email" autoComplete="username" placeholder="voce@exemplo.com" required maxLength={254}/></label>
        {mode === "signup" && <label className="field auth-field">WhatsApp com DDD<input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(11) 99999-0000" required maxLength={30}/></label>}
        <PasswordField name="password" label={mode === "login" ? "Senha" : "Crie uma senha"} newPassword={mode === "signup"}/>
        {mode === "signup" && <>
          <p className="auth-note password-hint">Use pelo menos 10 caracteres.</p>
          <PasswordField name="confirmPassword" label="Confirme a senha" newPassword/>
          <label className="member-check"><input type="checkbox" name="acceptTerms" required/><span>Li e aceito os <Link className="text-button" href="/conta/termos" target="_blank">termos do grupo e a política de privacidade</Link>.</span></label>
        </>}
        {error && <p className="error-box" role="alert">{error}</p>}
        <button type="submit" className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <LockKeyhole size={17}/>} {busy ? "Aguarde…" : copy.button}<ArrowRight size={17}/></button>
      </form>
      <div className="auth-bottom">{mode === "login"
        ? <span>Ainda não tem conta? <Link className="text-button" href="/conta/cadastro">Cadastre-se</Link></span>
        : <span>Já tem conta? <Link className="text-button" href="/conta/entrar">Entrar</Link></span>}</div>
      {mode === "login" && <p className="auth-note">Esqueceu a senha? Fale com a administração do grupo. Em breve você poderá recuperá-la por um código no WhatsApp.</p>}
    </div>
  </main></>;
}
