import { z } from "zod";
import { AppError, db, failure, json, readBody, requireStaff, sameOrigin } from "@/lib/server";
import { POLL_MAX_OPTIONS, enqueueLogout, enqueuePoll, enqueueText, pollOptionsError } from "@/lib/bot-shared";

type Context = { params: Promise<{ action: string }> };
const groupJid = z.string().trim().regex(/^[\d-]+@g\.us$/, "Escolha um grupo.");
const textSchema = z.object({ groupJid, text: z.string().trim().min(1, "Escreva a mensagem.").max(4000, "Mensagem muito longa."), mentionAll: z.boolean().default(false) });
const pollSchema = z.object({
  groupJid, name: z.string().trim().min(1, "Informe o título da enquete.").max(255),
  options: z.array(z.string().trim()).min(2, "A enquete precisa de pelo menos 2 opções.").max(POLL_MAX_OPTIONS, `No máximo ${POLL_MAX_OPTIONS} opções.`),
});

async function knownGroup(jid: string) {
  if (!await db().prepare("SELECT 1 AS x FROM bot_groups WHERE jid=?").bind(jid).first()) throw new AppError("O robô não participa desse grupo.", 400);
}

/** Staff commands to the bot. They go to bot_outbox; the worker sends them in order, paced. */
export async function POST(req: Request, context: Context) {
  try {
    sameOrigin(req);
    await requireStaff();
    const { action } = await context.params;
    const body = await readBody(req);
    if (action === "text") {
      const input = textSchema.parse(body);
      await knownGroup(input.groupJid);
      return json({ ok: true, id: await enqueueText(input.groupJid, { text: input.text, mentionAll: input.mentionAll }) }, 201);
    }
    if (action === "poll") {
      const input = pollSchema.parse(body);
      const problem = pollOptionsError(input.name, input.options);
      if (problem) throw new AppError(problem);
      await knownGroup(input.groupJid);
      return json({ ok: true, ...await enqueuePoll(input.groupJid, input.name, input.options) }, 201);
    }
    if (action === "logout") return json({ ok: true, id: await enqueueLogout() }, 201);
    throw new AppError("Página não encontrada.", 404);
  } catch (error) { return failure(error); }
}
