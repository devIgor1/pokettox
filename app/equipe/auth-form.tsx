"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, Vault } from "lucide-react";

type Mode = "login" | "setup" | "recover" | "account";
function PasswordField({ label, name, newPassword = false, optional = false }: { label: string; name: string; newPassword?: boolean; optional?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <label className="field auth-field">{label}<span className="password-input">
    <input name={name} type={visible ? "text" : "password"} autoComplete={newPassword ? "new-password" : "current-password"} required={!optional} minLength={newPassword ? 15 : 1} maxLength={128}/>
    <button type="button" aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={19}/> : <Eye size={19}/>}</button>
  </span></label>;
}
const content = {
  login: { title: "Entre na sua conta.", description: "Acesse o cofre e organize os envios da sua loja.", button: "Entrar na equipe" },
  setup: { title: "Seu acesso começa aqui.", description: "Cadastre o e-mail e a senha de quem vai administrar a loja.", button: "Criar administrador" },
  recover: { title: "Recupere seu acesso.", description: "Use o código salvo ao criar a conta para definir uma nova senha.", button: "Redefinir senha" },
  account: { title: "Cuide do seu acesso.", description: "Atualize o e-mail de acesso ou escolha uma nova senha.", button: "Salvar alterações" },
};
export default function AuthForm({ mode, initialEmail = "" }: { mode: Mode; initialEmail?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const [token, setToken] = useState(""), [ready, setReady] = useState(mode !== "setup"), [recoveryCode, setRecoveryCode] = useState("");
  const initialized = useRef(false);
  const copy = content[mode];
  useEffect(() => {
    if (mode !== "setup" || initialized.current) return;
    initialized.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("convite") || "";
    setToken(value); setReady(true);
    // The invitation never enters a request URL or remains in browser history.
    window.history.replaceState(null, "", window.location.pathname);
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(""); setSaved(false);
    const form = event.currentTarget, data = new FormData(form);
    const password = String(data.get("password") || "");
    if ((mode === "setup" || mode === "recover" || (mode === "account" && password)) && password !== String(data.get("confirmPassword") || "")) {
      setError("As senhas não coincidem. Confira os dois campos."); return;
    }
    setBusy(true);
    try {
      const payload: Record<string, string> = { email: String(data.get("email") || "") };
      if (mode !== "account" || password) payload.password = password;
      if (mode === "setup") payload.token = token;
      if (mode === "recover") payload.recoveryCode = String(data.get("recoveryCode") || "");
      if (mode === "account") payload.currentPassword = String(data.get("currentPassword") || "");
      const response = await fetch(`/api/admin/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string; recoveryCode?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível entrar agora.");
      if (result.recoveryCode) { setRecoveryCode(result.recoveryCode); setToken(""); form.reset(); }
      else if (mode === "account") { setSaved(true); form.querySelectorAll<HTMLInputElement>('input[name*="Password"],input[name="password"]').forEach(input => { input.value = ""; }); }
      else window.location.assign("/equipe");
    } catch (e) { setError(e instanceof Error ? e.message : "Tente novamente em instantes."); }
    finally { setBusy(false); }
  }
  function downloadRecovery() {
    const file = new Blob([`PokéCofre — código de recuperação\n\n${recoveryCode}\n\nGuarde em local privado. Este código permite redefinir sua senha uma única vez.\nRecuperar acesso: ${window.location.origin}/equipe/recuperar\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "pokecofre-codigo-de-recuperacao.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <><div className="color-ribbon"/><main className="auth-shell">
    <Link href={mode === "account" ? "/equipe" : "/"} className="back-button"><ArrowLeft size={17}/>{mode === "account" ? "Voltar à equipe" : "Voltar ao formulário"}</Link>
    <div className="auth-card">
      <div className="auth-brand"><span className="brand-icon"><Vault size={27}/></span><span>Poké<span className="brand-blue">Cofre</span></span></div>
      <div className="eyebrow"><ShieldCheck size={15}/> ÁREA DA EQUIPE</div>
      {recoveryCode ? <div className="recovery-result" role="status">
        <h1>Guarde sua <span>chave de acesso.</span></h1>
        <p>Este código recupera sua conta se você esquecer a senha. Ele será mostrado apenas agora.</p>
        <label className="field auth-field">Código de recuperação<textarea readOnly value={recoveryCode} aria-label="Código de recuperação" spellCheck={false}/></label>
        <button type="button" className="secondary-button" onClick={downloadRecovery}><Download size={17}/> Baixar código</button>
        <p className="auth-note">Mantenha o código em um local privado. Quem tiver acesso a ele poderá redefinir sua senha.</p>
        <a className="primary-button auth-submit" href="/equipe"><Check size={17}/> Já guardei. Ir para o painel</a>
      </div> : <>
        <h1>{copy.title}</h1><p className="auth-description">{copy.description}</p>
        {mode === "setup" && ready && !token ? <div className="notice-box">Para cadastrar o administrador, abra o convite privado enviado pelo responsável pelo site. Se a conta já foi criada, <Link className="text-button" href="/equipe/entrar">entre aqui</Link>.</div> : <form onSubmit={submit} className="auth-form">
          <label className="field auth-field">E-mail<input name="email" type="email" autoComplete="username" placeholder="voce@exemplo.com" defaultValue={initialEmail} required maxLength={254}/></label>
          {mode === "recover" && <label className="field auth-field">Código de recuperação<input name="recoveryCode" autoComplete="off" spellCheck={false} required maxLength={100}/></label>}
          {mode === "account" && <PasswordField name="currentPassword" label="Senha atual"/>}
          <PasswordField name="password" label={mode === "login" ? "Senha" : mode === "account" ? "Nova senha (opcional)" : "Crie uma senha"} newPassword={mode !== "login"} optional={mode === "account"}/>
          {mode !== "login" && <><p className="auth-note password-hint">Use pelo menos 15 caracteres. Uma frase com várias palavras é uma boa opção.</p><PasswordField name="confirmPassword" label="Confirme a nova senha" newPassword optional={mode === "account"}/></>}
          {error && <p className="error-box" role="alert">{error}</p>}
          {saved && <p className="auth-success" role="status"><Check size={17}/> Acesso atualizado. As outras sessões foram encerradas.</p>}
          <button type="submit" className="primary-button auth-submit" disabled={busy || !ready}>{busy ? <LoaderCircle className="spin" size={18}/> : <LockKeyhole size={17}/>} {busy ? "Aguarde…" : copy.button}<ArrowRight size={17}/></button>
        </form>}
        <div className="auth-bottom">{mode === "login" ? <Link href="/equipe/recuperar"><KeyRound size={15}/> Esqueci minha senha</Link> : mode !== "account" ? <Link href="/equipe/entrar">Já tenho uma conta. Entrar</Link> : <span>Confirme sua senha atual para alterar o acesso.</span>}</div>
        {mode === "login" && <p className="auth-note">Acesso exclusivo para o administrador da loja.</p>}
      </>}
    </div><p className="auth-footer">Suas cartas organizadas. Seu acesso protegido.</p>
  </main></>;
}
