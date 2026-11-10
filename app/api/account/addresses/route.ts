import { AppError, db, failure, json, readBody, sameOrigin } from "@/lib/server";
import { requireParticipant } from "@/lib/participant-session";
import { MAX_ADDRESSES, addressSchema } from "@/lib/participant";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const participant = await requireParticipant(req);
    const a = addressSchema.parse(await readBody(req));
    const count = await db().prepare("SELECT COUNT(*) AS n FROM addresses WHERE participant_id=?").bind(participant.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_ADDRESSES) throw new AppError(`Você pode guardar até ${MAX_ADDRESSES} endereços. Remova um para adicionar outro.`, 409);
    const now = Date.now(), id = crypto.randomUUID();
    // The first address becomes the default one.
    await db().prepare(`INSERT INTO addresses (id,participant_id,label,recipient,cep,street,number,complement,district,city,state,is_default,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,CASE WHEN EXISTS (SELECT 1 FROM addresses WHERE participant_id=? AND is_default=1) THEN 0 ELSE 1 END,?,?)`)
      .bind(id, participant.id, a.label, a.recipient, a.cep, a.street, a.number, a.complement, a.district, a.city, a.state, participant.id, now, now).run();
    return json({ ok: true, id }, 201);
  } catch (error) { return failure(error); }
}
