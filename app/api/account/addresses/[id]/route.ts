import { AppError, db, failure, json, readBody, sameOrigin } from "@/lib/server";
import { requireParticipant } from "@/lib/participant-session";
import { addressSchema } from "@/lib/participant";

type Context = { params: Promise<{ id: string }> };
const notFound = () => new AppError("Endereço não encontrado.", 404);

/** Updates an address. */
export async function PUT(req: Request, context: Context) {
  try {
    sameOrigin(req);
    const participant = await requireParticipant(req), { id } = await context.params;
    const a = addressSchema.parse(await readBody(req));
    const result = await db().prepare(`UPDATE addresses SET label=?,recipient=?,cep=?,street=?,number=?,complement=?,district=?,city=?,state=?,updated_at=?
      WHERE id=? AND participant_id=?`)
      .bind(a.label, a.recipient, a.cep, a.street, a.number, a.complement, a.district, a.city, a.state, Date.now(), id, participant.id).run();
    if (result.meta.changes !== 1) throw notFound();
    return json({ ok: true });
  } catch (error) { return failure(error); }
}

/** Makes this address the default one. */
export async function PATCH(req: Request, context: Context) {
  try {
    sameOrigin(req);
    const participant = await requireParticipant(req), { id } = await context.params;
    const [, set] = await db().batch([
      db().prepare("UPDATE addresses SET is_default=0 WHERE participant_id=? AND is_default=1 AND id<>? AND EXISTS (SELECT 1 FROM addresses WHERE id=? AND participant_id=?)").bind(participant.id, id, id, participant.id),
      db().prepare("UPDATE addresses SET is_default=1 WHERE id=? AND participant_id=?").bind(id, participant.id),
    ]);
    if (set.meta.changes !== 1) throw notFound();
    return json({ ok: true });
  } catch (error) { return failure(error); }
}

/** Removes an address; if it was the default, the most recent remaining one takes its place. */
export async function DELETE(req: Request, context: Context) {
  try {
    sameOrigin(req);
    const participant = await requireParticipant(req), { id } = await context.params;
    const [removed] = await db().batch([
      db().prepare("DELETE FROM addresses WHERE id=? AND participant_id=?").bind(id, participant.id),
      db().prepare(`UPDATE addresses SET is_default=1 WHERE id=(SELECT id FROM addresses WHERE participant_id=? ORDER BY created_at DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM addresses WHERE participant_id=? AND is_default=1)`).bind(participant.id, participant.id),
    ]);
    if (removed.meta.changes !== 1) throw notFound();
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
