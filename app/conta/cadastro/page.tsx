import { redirect } from "next/navigation";
import { getParticipant } from "@/lib/participant-auth";
import MemberAuth from "../member-auth";
export const dynamic = "force-dynamic";
export default async function MemberSignupPage() {
  if (await getParticipant()) redirect("/conta");
  return <MemberAuth mode="signup"/>;
}
