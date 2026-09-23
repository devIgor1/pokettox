import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin-auth";
import Staff from "./staff";
export const dynamic="force-dynamic";
export default async function StaffPage(){
  const admin=await getAdmin();
  if(!admin) redirect("/equipe/entrar");
  return <Staff/>;
}
