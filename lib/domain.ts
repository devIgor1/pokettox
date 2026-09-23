export type Customer = { name: string; cpf: string; phone: string; cep: string; street: string; number: string; complement: string; district: string; city: string; state: string };
export type Quote = { id: string; service: "PAC" | "SEDEX"; days: number | null; baseCents: number; insuranceCents: number; totalCents: number };
export const digits = (v: string) => v.replace(/\D/g, "");
export function validCpf(value: string) {
  const cpf = digits(value);
  if(cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for(let i = 9; i < 11; i++) { let sum = 0; for(let j = 0; j < i; j++) sum += Number(cpf[j]) * (i + 1 - j); const d = (sum * 10) % 11; if((d === 10 ? 0 : d) !== Number(cpf[i])) return false; }
  return true;
}
export function totalCents(base: number, insurance: number) { if(!Number.isSafeInteger(base) || !Number.isSafeInteger(insurance) || base < 0 || insurance < 0) throw new Error("Cotação inválida."); return base + insurance + 400; }
export const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
