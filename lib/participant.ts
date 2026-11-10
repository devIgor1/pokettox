import { z } from "zod";
import { digits, validCpf } from "./domain";
import { customerSchema } from "./server";

export const MAX_ADDRESSES = 5;
export const emailSchema = z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254);
export const passwordSchema = z.string().min(10, "Use uma senha com pelo menos 10 caracteres.").max(128, "Use até 128 caracteres na senha.");

/** Brazilian mobile/landline with DDD → digits with country code (5511999990000). */
export function normalizePhone(value: string) {
  let v = digits(value);
  if ((v.length === 12 || v.length === 13) && v.startsWith("55")) v = v.slice(2);
  return [10, 11].includes(v.length) ? `55${v}` : null;
}
export const phoneSchema = z.string().trim().max(30)
  .transform((v, ctx) => normalizePhone(v) ?? (ctx.addIssue({ code: "custom", message: "Informe um WhatsApp com DDD." }), z.NEVER));
const nameSchema = z.string().trim().min(3, "Informe seu nome completo.").max(150, "Nome muito longo.");
const cpfSchema = z.string().trim().max(20)
  .transform(v => digits(v))
  .refine(v => v === "" || validCpf(v), "Informe um CPF válido.");

export const signupSchema = z.object({
  name: nameSchema, email: emailSchema, phone: phoneSchema, password: passwordSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Aceite os termos do grupo para criar a conta." }) }),
});
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const profileSchema = z.object({ name: nameSchema, cpf: cpfSchema, phone: phoneSchema });
export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), password: passwordSchema });

// Same address rules as the shipping wizard (lib/server.ts customerSchema).
export const addressSchema = customerSchema.pick({ cep: true, street: true, number: true, complement: true, district: true, city: true, state: true })
  .extend({
    label: z.string().trim().min(1, "Dê um nome ao endereço (ex.: Casa).").max(40, "Nome do endereço muito longo."),
    recipient: nameSchema,
  });
export type AddressInput = z.infer<typeof addressSchema>;
export type Address = AddressInput & { id: string; is_default: number };
