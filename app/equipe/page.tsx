import { requireChatGPTUser } from "@/app/chatgpt-auth";
import Staff from "./staff";
export const dynamic="force-dynamic";
export default async function StaffPage(){await requireChatGPTUser("/equipe");return <Staff/>;}
