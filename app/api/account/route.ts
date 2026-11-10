import { db, failure, json } from "@/lib/server";
import { requireParticipant } from "@/lib/participant-session";
import type { Address } from "@/lib/participant";

export async function GET(req: Request) {
  try {
    const participant = await requireParticipant(req);
    const { results: addresses } = await db().prepare(`SELECT id,label,recipient,cep,street,number,complement,district,city,state,is_default
      FROM addresses WHERE participant_id=? ORDER BY is_default DESC, created_at ASC`).bind(participant.id).all<Address>();
    return json({ participant, addresses });
  } catch (error) { return failure(error); }
}
