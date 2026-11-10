import { AppError, db, failure, json, keyLimit, limit, readBody, sameOrigin } from "@/lib/server";
import { dummyPasswordHash, hashPassword, verifyPassword } from "@/lib/password";
import { VERIFICATION_MINUTES, botOnline, getBotStatus, startPhoneVerification, verificationMessage } from "@/lib/bot-shared";
import { loginSchema, passwordChangeSchema, profileSchema, signupSchema } from "@/lib/participant";
import { newParticipantSession, participantCookie, requireParticipant, revokeParticipantSession, type Participant } from "@/lib/participant-session";

type Context = { params: Promise<{ action: string }> };
const columns = "id,email,name,cpf,phone,pending_phone,status,version";

async function signedIn(req: Request, participant: Participant, status = 200) {
  const response = json({ ok: true, participant }, status);
  response.headers.set("Set-Cookie", participantCookie(req, await newParticipantSession(participant)));
  return response;
}

export async function POST(req: Request, context: Context) {
  try {
    sameOrigin(req);
    const { action } = await context.params;
    if (!["signup", "login", "logout", "profile", "password", "phone-code"].includes(action)) throw new AppError("Página não encontrada.", 404);
    if (action === "logout") {
      await revokeParticipantSession(req);
      const response = json({ ok: true });
      response.headers.set("Set-Cookie", participantCookie(req, "", 0));
      return response;
    }
    await limit(req, `account-${action}`, 30);
    const body = await readBody(req);

    if (action === "signup") {
      const input = signupSchema.parse(body);
      await keyLimit(`account-signup:${input.email}`, 5);
      const now = Date.now(), passwordHash = await hashPassword(input.password);
      // The phone stays pending until the bot confirms it (it is what links votes in the group to this account).
      const created = await db().prepare(`INSERT INTO participants (id,email,password_hash,name,pending_phone,status,version,terms_accepted_at,created_at,updated_at)
        VALUES (?,?,?,?,?,'active',1,?,?,?) ON CONFLICT DO NOTHING RETURNING ${columns}`)
        .bind(crypto.randomUUID(), input.email, passwordHash, input.name, input.phone, now, now, now).first<Participant>();
      if (!created) throw new AppError("Este e-mail já tem cadastro. Entre com sua senha.", 409);
      return await signedIn(req, created, 201);
    }

    if (action === "login") {
      const input = loginSchema.parse(body);
      await keyLimit(`account-login:${input.email}`, 10);
      const secret = await db().prepare("SELECT password_hash FROM participants WHERE email=?").bind(input.email).first<{ password_hash: string | null }>();
      const valid = await verifyPassword(input.password, secret?.password_hash || dummyPasswordHash);
      if (!secret || !valid) throw new AppError("E-mail ou senha incorretos.", 401);
      const participant = await db().prepare(`SELECT ${columns} FROM participants WHERE email=?`).bind(input.email).first<Participant>();
      if (!participant) throw new AppError("E-mail ou senha incorretos.", 401);
      await revokeParticipantSession(req);
      return await signedIn(req, participant);
    }

    const participant = await requireParticipant(req);

    if (action === "profile") {
      const input = profileSchema.parse(body);
      // Informing the already-verified number keeps it; any other number waits for verification.
      const updated = await db().prepare(`UPDATE participants SET name=?, cpf=?, pending_phone=CASE WHEN phone IS NOT DISTINCT FROM ? THEN NULL ELSE ? END, updated_at=?
        WHERE id=? RETURNING ${columns}`)
        .bind(input.name, input.cpf || null, input.phone, input.phone, Date.now(), participant.id).first<Participant>();
      return json({ ok: true, participant: updated });
    }

    if (action === "phone-code") {
      // The participant sends this code to the bot from the number being confirmed.
      if (!participant.pending_phone) throw new AppError("Seu WhatsApp já está confirmado.", 409);
      await keyLimit(`account-phone-code:${participant.id}`, 6);
      const bot = await getBotStatus();
      if (!bot?.phone) throw new AppError("A confirmação pelo WhatsApp ainda não está disponível. Tente mais tarde.", 503);
      const code = await startPhoneVerification(participant.id, participant.pending_phone);
      return json({ ok: true, code, botPhone: bot.phone, botOnline: botOnline(bot), link: `https://wa.me/${bot.phone}?text=${encodeURIComponent(verificationMessage(code))}`, minutes: VERIFICATION_MINUTES });
    }

    // action === "password"
    const input = passwordChangeSchema.parse(body);
    await keyLimit(`account-password:${participant.id}`, 10);
    const account = await db().prepare("SELECT password_hash FROM participants WHERE id=?").bind(participant.id).first<{ password_hash: string | null }>();
    if (!account?.password_hash || !await verifyPassword(input.currentPassword, account.password_hash)) throw new AppError("A senha atual está incorreta.", 400);
    const updated = await db().prepare(`UPDATE participants SET password_hash=?, version=version+1, updated_at=? WHERE id=? AND version=? RETURNING ${columns}`)
      .bind(await hashPassword(input.password), Date.now(), participant.id, participant.version).first<Participant>();
    if (!updated) throw new AppError("Seu acesso mudou. Entre novamente e tente outra vez.", 409);
    // Signs out every other device.
    await db().prepare("DELETE FROM participant_sessions WHERE participant_id=? AND version<?").bind(participant.id, updated.version).run();
    return await signedIn(req, updated);
  } catch (error) { return failure(error); }
}
