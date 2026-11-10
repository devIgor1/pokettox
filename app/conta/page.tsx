import { redirect } from "next/navigation";
import { getParticipant } from "@/lib/participant-auth";
import Dashboard from "./dashboard";
export const dynamic = "force-dynamic";
export default async function MemberPage() {
  if (!await getParticipant()) redirect("/conta/entrar");
  return <Dashboard/>;
}
