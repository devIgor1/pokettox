import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin-auth";
import AuthForm from "../auth-form";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  const admin = await getAdmin();
  if (!admin) redirect("/equipe/entrar");
  return <AuthForm mode="account" initialEmail={admin.email}/>;
}
