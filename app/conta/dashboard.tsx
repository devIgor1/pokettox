"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, Check, Clock3, KeyRound, LoaderCircle, LogOut, MapPin, MessageCircle, Pencil, Plus, Star, Trash2, UserRound, Vault } from "lucide-react";
import { digits } from "@/lib/domain";
import type { Address } from "@/lib/participant";
import type { Participant } from "@/lib/participant-session";
import { PasswordField } from "./member-auth";

// Form state is free text; the server validates (including the UF list).
type AddressForm = Record<"label" | "recipient" | "cep" | "street" | "number" | "complement" | "district" | "city" | "state", string>;
const blankAddress: AddressForm = { label: "", recipient: "", cep: "", street: "", number: "", complement: "", district: "", city: "", state: "" };
/** 5511999990000 → (11) 99999-0000 */
function formatPhone(value: string | null) {
  if (!value) return "";
  const v = value.startsWith("55") ? value.slice(2) : value;
  return v.length === 11 ? `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}` : v.length === 10 ? `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}` : value;
}
async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { error?: string; participant?: Participant };
  if (response.status === 401) throw new Error("Sua sessão terminou. Atualize a página e entre novamente.");
  if (!response.ok) throw new Error(result.error || "Não foi possível salvar agora. Tente novamente.");
  return result;
}

type PhoneCode = { code: string; botPhone: string; botOnline: boolean; link: string; minutes: number };
/** The participant sends the code to the bot from the number being confirmed. */
function PhoneConfirm({ pendingPhone, onConfirmed }: { pendingPhone: string; onConfirmed: (p: Participant) => void }) {
  const [code, setCode] = useState<PhoneCode | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!code) return;
    // While the code is on screen, check every few seconds whether the bot has confirmed it.
    const timer = setInterval(async () => {
      try { const account = await fetchAccount(); if (account && !account.participant.pending_phone) onConfirmed(account.participant); } catch { /* try again on the next tick */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [code, onConfirmed]);
  async function generate() {
    setBusy(true); setError("");
    try { setCode(await send("/api/account/phone-code", "POST", {}) as unknown as PhoneCode); }
    catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); } finally { setBusy(false); }
  }
  return <div className="notice-box member-confirm">
    <p><Clock3 size={15}/> Falta confirmar o número {formatPhone(pendingPhone)}. Assim seus lances no grupo aparecem nesta conta.</p>
    {code ? <>
      <div className="member-code" aria-live="polite"><small>SEU CÓDIGO</small><strong>{code.code.replace(/^(\d{3})(\d{3})$/, "$1 $2")}</strong></div>
      <a className="primary-button" href={code.link} target="_blank" rel="noopener noreferrer"><MessageCircle size={17}/> Enviar código pelo WhatsApp</a>
      <p className="member-small">Envie a partir do número {formatPhone(pendingPhone)}. Se o WhatsApp não abrir, mande o código para {formatPhone(code.botPhone)}. Ele vale por {code.minutes} minutos e esta página atualiza sozinha quando a confirmação chegar.</p>
      {!code.botOnline && <p className="member-small">O robô está temporariamente offline; sua mensagem será lida assim que ele voltar.</p>}
    </> : <button type="button" className="secondary-button" onClick={generate} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <MessageCircle size={16}/>} Confirmar pelo WhatsApp</button>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </div>;
}

function Profile({ participant, onSaved }: { participant: Participant; onSaved: (p: Participant) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const shownPhone = participant.pending_phone || participant.phone;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(""); setSaved(false);
    try {
      const result = await send("/api/account/profile", "POST", { name: data.get("name"), cpf: data.get("cpf"), phone: data.get("phone") });
      if (result.participant) onSaved(result.participant);
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); } finally { setBusy(false); }
  }
  return <section className="member-card" aria-labelledby="profile-title">
    <div className="section-title"><span className="section-icon"><UserRound size={21}/></span><div><h2 id="profile-title">Dados pessoais</h2><p>{participant.email}</p></div></div>
    <form className="fields personal-fields" onSubmit={submit}>
      <label className="field field-name">Nome completo<input name="name" defaultValue={participant.name || ""} autoComplete="name" required minLength={3} maxLength={150}/></label>
      <label className="field"><span>CPF <small>necessário para envios</small></span><input name="cpf" defaultValue={participant.cpf || ""} inputMode="numeric" autoComplete="off" maxLength={20} placeholder="000.000.000-00"/></label>
      <label className="field">WhatsApp com DDD<input name="phone" type="tel" inputMode="tel" defaultValue={formatPhone(shownPhone)} autoComplete="tel-national" required maxLength={30}/></label>
      <div className="field-name member-phone-status">
        {participant.pending_phone
          ? <PhoneConfirm pendingPhone={participant.pending_phone} onConfirmed={onSaved}/>
          : participant.phone ? <p className="auth-success"><BadgeCheck size={16}/> WhatsApp confirmado. Seus lances no grupo aparecem nesta conta.</p> : null}
      </div>
      {error && <p className="error-box field-name" role="alert">{error}</p>}
      {saved && <p className="auth-success field-name" role="status"><Check size={16}/> Dados salvos.</p>}
      <div className="field-name member-actions"><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} Salvar dados</button></div>
    </form>
  </section>;
}

function AddressEditor({ initial, onCancel, onSaved }: { initial: Address | null; onCancel: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AddressForm>(initial ? { ...initial } : blankAddress);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [cepStatus, setCepStatus] = useState("");
  const cepRequest = useRef(0);
  const set = (key: keyof AddressForm, value: string) => { setForm(f => ({ ...f, [key]: value })); setError(""); };
  async function lookupCep() {
    const cep = digits(form.cep); if (cep.length !== 8) return;
    const request = ++cepRequest.current; setCepStatus("Buscando endereço…");
    try {
      const res = await fetch(`/api/cep?cep=${cep}`), data = await res.json() as { logradouro: string; bairro: string; localidade: string; uf: string };
      if (request !== cepRequest.current) return;
      if (!res.ok) throw new Error();
      setForm(f => ({ ...f, street: data.logradouro || f.street, district: data.bairro || f.district, city: data.localidade || f.city, state: data.uf || f.state }));
      setCepStatus("Endereço encontrado. Confira os dados.");
    } catch { if (request === cepRequest.current) setCepStatus("Não foi possível buscar. Preencha manualmente."); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const body = { ...form, state: form.state.toUpperCase() };
      await (initial ? send(`/api/account/addresses/${initial.id}`, "PUT", body) : send("/api/account/addresses", "POST", body));
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); setBusy(false); }
  }
  const input = (key: keyof AddressForm, label: string, className: string, extra: Record<string, unknown> = {}) =>
    <label className={`field ${className}`}>{label}<input value={form[key]} onChange={e => set(key, e.target.value)} required={key !== "complement"} maxLength={150} {...extra}/></label>;
  return <form className="member-address-form" onSubmit={submit}>
    <div className="fields personal-fields">
      {input("label", "Nome do endereço", "", { placeholder: "Casa, Trabalho…", maxLength: 40 })}
      {input("recipient", "Destinatário", "", { autoComplete: "name" })}
    </div>
    <div className="fields address-fields member-address-fields">
      {input("cep", "CEP", "field-cep", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 9, onBlur: lookupCep, placeholder: "00000-000" })}
      <p className="cep-hint" aria-live="polite">{cepStatus}</p>
      {input("street", "Rua", "field-street", { autoComplete: "address-line1" })}
      {input("number", "Número", "field-number", { maxLength: 15 })}
      {input("complement", "Complemento (opcional)", "field-complement", { autoComplete: "address-line2" })}
      {input("district", "Bairro", "field-district")}
      {input("city", "Cidade", "field-city", { autoComplete: "address-level2" })}
      {input("state", "UF", "field-state", { maxLength: 2, autoComplete: "address-level1" })}
    </div>
    {error && <p className="error-box" role="alert">{error}</p>}
    <div className="member-actions">
      <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancelar</button>
      <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} Salvar endereço</button>
    </div>
  </form>;
}

function Addresses({ addresses, reload }: { addresses: Address[]; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  async function act(id: string, method: "PATCH" | "DELETE") {
    if (method === "DELETE" && !window.confirm("Remover este endereço?")) return;
    setBusy(id); setError("");
    try { await send(`/api/account/addresses/${id}`, method); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); } finally { setBusy(""); }
  }
  return <section className="member-card" aria-labelledby="addresses-title">
    <div className="section-title"><span className="section-icon"><MapPin size={21}/></span><div><h2 id="addresses-title">Endereços de envio</h2><p>O endereço padrão é sugerido quando você pedir um envio.</p></div></div>
    {editing ? <AddressEditor initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={async () => { await reload(); setEditing(null); }}/> : <>
      {addresses.length === 0 && <p className="member-empty">Nenhum endereço cadastrado ainda.</p>}
      <ul className="member-address-list">
        {addresses.map(a => <li key={a.id} className={a.is_default ? "is-default" : ""}>
          <div>
            <strong>{a.label}{a.is_default ? <span className="choice-tag blue-tag">Padrão</span> : null}</strong>
            <span>{a.recipient}</span>
            <span>{a.street}, {a.number}{a.complement ? ` — ${a.complement}` : ""} · {a.district}</span>
            <span>{a.city}/{a.state} · CEP {a.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}</span>
          </div>
          <div className="member-address-actions">
            {!a.is_default && <button className="text-button" disabled={busy === a.id} onClick={() => act(a.id, "PATCH")}><Star size={14}/> Tornar padrão</button>}
            <button className="text-button" disabled={busy === a.id} onClick={() => setEditing(a)}><Pencil size={14}/> Editar</button>
            <button className="text-button member-danger" disabled={busy === a.id} onClick={() => act(a.id, "DELETE")}><Trash2 size={14}/> Remover</button>
          </div>
        </li>)}
      </ul>
      {error && <p className="error-box" role="alert">{error}</p>}
      {addresses.length < 5 && <button className="secondary-button member-add" onClick={() => setEditing("new")}><Plus size={16}/> Adicionar endereço</button>}
    </>}
  </section>;
}

function PasswordChange() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget, data = new FormData(form), password = String(data.get("password") || "");
    if (password !== String(data.get("confirmPassword") || "")) { setError("As senhas não coincidem."); return; }
    setBusy(true); setError(""); setSaved(false);
    try { await send("/api/account/password", "POST", { currentPassword: data.get("currentPassword"), password }); form.reset(); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); } finally { setBusy(false); }
  }
  return <section className="member-card" aria-labelledby="password-title">
    <div className="section-title"><span className="section-icon"><KeyRound size={21}/></span><div><h2 id="password-title">Senha</h2><p>Ao trocar a senha, os outros aparelhos saem da conta.</p></div></div>
    <form className="auth-form member-password" onSubmit={submit}>
      <PasswordField name="currentPassword" label="Senha atual"/>
      <PasswordField name="password" label="Nova senha" newPassword/>
      <PasswordField name="confirmPassword" label="Confirme a nova senha" newPassword/>
      {error && <p className="error-box" role="alert">{error}</p>}
      {saved && <p className="auth-success" role="status"><Check size={16}/> Senha alterada.</p>}
      <div className="member-actions"><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <KeyRound size={17}/>} Trocar senha</button></div>
    </form>
  </section>;
}

type Account = { participant: Participant; addresses: Address[] };
async function fetchAccount(): Promise<Account | null> {
  const response = await fetch("/api/account", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error();
  return await response.json() as Account;
}

export default function Dashboard() {
  const router = useRouter();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]), [error, setError] = useState(""), [leaving, setLeaving] = useState(false);
  const apply = useCallback((account: Account | null) => {
    if (!account) { router.replace("/conta/entrar"); return; }
    setParticipant(account.participant); setAddresses(account.addresses); setError("");
  }, [router]);
  const failed = useCallback(() => setError("Não foi possível carregar sua conta. Atualize a página."), []);
  useEffect(() => {
    let live = true;
    fetchAccount().then(account => { if (live) apply(account); }, () => { if (live) failed(); });
    return () => { live = false; };
  }, [apply, failed]);
  const reload = useCallback(async () => { try { apply(await fetchAccount()); } catch { failed(); } }, [apply, failed]);
  async function logout() {
    setLeaving(true);
    try { await send("/api/account/logout", "POST", {}); router.replace("/conta/entrar"); } catch { setLeaving(false); }
  }
  return <><div className="color-ribbon"/><main className="member-shell">
    <div className="member-top">
      <Link className="auth-brand" href="/"><span className="brand-icon"><Vault size={25}/></span><span>Poké<span className="brand-blue">Cofre</span></span></Link>
      <button className="back-button" onClick={logout} disabled={leaving}><LogOut size={16}/>{leaving ? "Saindo…" : "Sair"}</button>
    </div>
    {error && <p className="error-box" role="alert">{error}</p>}
    {!participant ? !error && <p className="member-loading"><LoaderCircle className="spin" size={18}/> Carregando sua conta…</p> : <>
      <div className="eyebrow"><span/> MINHA CONTA</div>
      <h1>Olá, <span>{(participant.name || "colecionador").split(" ")[0]}</span>.</h1>
      <div className="member-grid">
        <section className="member-card member-vault" aria-labelledby="vault-title">
          <div className="section-title"><span className="section-icon"><Vault size={21}/></span><div><h2 id="vault-title">Meu cofre</h2><p>Cartas arrematadas e pagas ficam guardadas aqui até você pedir o envio.</p></div></div>
          <p className="member-empty">Seu cofre ainda está vazio. As cartas que você arrematar nos leilões do grupo aparecerão aqui.</p>
        </section>
        <Profile participant={participant} onSaved={setParticipant}/>
        <Addresses addresses={addresses} reload={reload}/>
        <PasswordChange/>
      </div>
    </>}
  </main></>;
}
