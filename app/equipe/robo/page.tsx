import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin-auth";
import BotPanel from "./bot-panel";
export const dynamic = "force-dynamic";
export default async function BotPage() {
  if (!await getAdmin()) redirect("/equipe/entrar");
  return <BotPanel/>;
}
