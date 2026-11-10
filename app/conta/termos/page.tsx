import Link from "next/link";
import { ArrowLeft, Vault } from "lucide-react";

// RASCUNHO — o texto definitivo dos termos e da política de privacidade deve ser revisado pela administração do grupo.
export default function TermsPage() {
  return <><div className="color-ribbon"/><main className="auth-shell">
    <Link href="/conta/cadastro" className="back-button"><ArrowLeft size={17}/> Voltar ao cadastro</Link>
    <div className="auth-card member-terms">
      <div className="auth-brand"><span className="brand-icon"><Vault size={27}/></span><span>Poké<span className="brand-blue">Cofre</span></span></div>
      <h1>Termos do grupo e privacidade</h1>
      <h2>Leilões</h2>
      <p>Votar em uma opção da enquete de uma carta é um lance. A maior opção votada arremata a carta; em caso de empate, vale quem votou primeiro. Arremates geram uma cobrança com prazo de pagamento informado no privado.</p>
      <p>Quem tiver pagamento com prazo vencido não tem lances considerados até regularizar a pendência.</p>
      <h2>Dados pessoais</h2>
      <p>Usamos seu nome, e-mail, WhatsApp, CPF e endereço apenas para identificar seus lances, cobrar arremates e enviar suas cartas. O CPF e o endereço são compartilhados com a transportadora somente quando você solicita um envio.</p>
      <p>Você pode pedir a correção ou a exclusão dos seus dados à administração do grupo, respeitadas as obrigações de guarda de registros de pagamentos.</p>
    </div>
  </main></>;
}
