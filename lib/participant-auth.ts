// Page-side helper: reads the participant session through next/headers.
import { cookies } from "next/headers";
import { participantByToken, pickSessionToken } from "./participant-session";

export async function getParticipant() {
  const jar = await cookies();
  return participantByToken(pickSessionToken(name => jar.get(name)?.value));
}
