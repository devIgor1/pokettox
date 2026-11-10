import { redirect } from "next/navigation";
import { getParticipant } from "@/lib/participant-auth";
import MemberAuth from "../member-auth";
export const dynamic = "force-dynamic";
export default async function MemberLoginPage() {
  if (await getParticipant()) redirect("/conta");
  return <MemberAuth mode="login"/>;
}
