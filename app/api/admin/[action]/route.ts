import { z } from "zod";
import { AppError, db, failure, json, limit, readBody, requireStaff, setting } from "@/lib/server";
import { newSession, revokeSession, sessionCookie, type Admin } from "@/lib/admin-auth";
import { dummyPasswordHash, hashPassword, matchesToken, randomToken, tokenHash, verifyPassword } from "@/lib/password";

const emailSchema = z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254);
const passwordSchema = z.string().min(15, "Use uma senha com pelo menos 15 caracteres.").max(128, "Use até 128 caracteres na senha.");
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
type Account = Admin & { password_hash: string; recovery_hash: string; active: number };
type Context = { params: Promise<{ action: string }> };

function strictOrigin(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) throw new AppError("Origem da solicitação inválida.", 403);
}
async function accountLimit(email: string, action: string) {
  const window = Math.floor(Date.now() / 900000);
  const key = tokenHash(`admin:${action}:${email}:${window}`);
  const row = await db().prepare("INSERT INTO request_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=request_limits.count+1 RETURNING count")
    .bind(key, (window + 1) * 900000).first<{ count: number }>();
  if (row && row.count > 10) throw new AppError("Muitas tentativas. Aguarde 15 minutos e tente novamente.", 429);
}
async function signedIn(req: Request, admin: Admin, extra = {}) {
  const response = json({ ok: true, ...extra });
  response.headers.set("Set-Cookie", sessionCookie(req, await newSession(admin)));
  return response;
}
function setupIsValid(token: string) {
  return Date.now() < Number(setting("ADMIN_SETUP_EXPIRES_AT")) && matchesToken(token, setting("ADMIN_SETUP_TOKEN_HASH"));
}

export async function POST(req: Request, context: Context) {
  try {
    strictOrigin(req);
    const { action } = await context.params;
    if (!["login", "setup", "recover", "account", "logout"].includes(action)) throw new AppError("Página não encontrada.", 404);
    if (action === "logout") {
      await revokeSession();
      const response = json({ ok: true });
      response.headers.set("Set-Cookie", sessionCookie(req, "", 0));
      return response;
    }
    await limit(req, `admin-${action}`, 25);
    const body = await readBody(req);

    if (action === "setup") {
      const input = z.object({ token: z.string().max(100), email: emailSchema, password: passwordSchema }).parse(body);
      if (!setupIsValid(input.token)) throw new AppError("Convite inválido ou expirado. Solicite um novo link ao responsável pelo site.", 403);
      if (await db().prepare("SELECT id FROM admin_accounts WHERE id='primary-admin'").first()) throw new AppError("O administrador já foi cadastrado. Use a tela de login.", 409);
      const passwordHash = await hashPassword(input.password), recoveryCode = randomToken();
      // The fixed primary key makes concurrent redemption of the invite atomic.
      const result = await db().prepare("INSERT INTO admin_accounts (id,email,password_hash,recovery_hash,active,version,created_at) VALUES ('primary-admin',?,?,?,1,1,?) ON CONFLICT DO NOTHING")
        .bind(input.email, passwordHash, tokenHash(recoveryCode), Date.now()).run();
      if (result.meta.changes !== 1) throw new AppError("Este convite já foi utilizado. Use a tela de login.", 409);
      return await signedIn(req, { id: "primary-admin", email: input.email, version: 1 }, { recoveryCode });
    }

    if (action === "login") {
      const input = loginSchema.parse(body);
      await accountLimit(input.email, action);
      const account = await db().prepare("SELECT * FROM admin_accounts WHERE email=?").bind(input.email).first<Account>();
      const valid = await verifyPassword(input.password, account?.password_hash || dummyPasswordHash);
      if (!account || !valid || account.active !== 1) throw new AppError("E-mail ou senha incorretos.", 401);
      await revokeSession();
      return await signedIn(req, account);
    }

    if (action === "recover") {
      const input = z.object({ email: emailSchema, recoveryCode: z.string().trim().max(100), password: passwordSchema }).parse(body);
      await accountLimit(input.email, action);
      const account = await db().prepare("SELECT * FROM admin_accounts WHERE email=? AND active=1").bind(input.email).first<Account>();
      if (!account || !matchesToken(input.recoveryCode, account.recovery_hash)) throw new AppError("E-mail ou código de recuperação inválido.", 400);
      const nextCode = randomToken(), passwordHash = await hashPassword(input.password);
      const updated = await db().prepare("UPDATE admin_accounts SET password_hash=?,recovery_hash=?,version=version+1 WHERE id=? AND recovery_hash=? AND version=? RETURNING id,email,version")
        .bind(passwordHash, tokenHash(nextCode), account.id, account.recovery_hash, account.version).first<Admin>();
      if (!updated) throw new AppError("Este código já foi utilizado. Use o código de recuperação mais recente.", 409);
      await db().prepare("DELETE FROM admin_sessions WHERE admin_id=? AND version<?").bind(account.id, updated.version).run();
      return await signedIn(req, updated, { recoveryCode: nextCode });
    }

    const admin = await requireStaff();
    const input = z.object({ email: emailSchema, currentPassword: z.string().min(1).max(128), password: passwordSchema.optional() }).parse(body);
    await accountLimit(admin.email, action);
    const account = await db().prepare("SELECT * FROM admin_accounts WHERE id=? AND active=1").bind(admin.id).first<Account>();
    if (!account || !await verifyPassword(input.currentPassword, account.password_hash)) throw new AppError("A senha atual está incorreta.", 400);
    const passwordHash = input.password ? await hashPassword(input.password) : account.password_hash;
    const updated = await db().prepare("UPDATE admin_accounts SET email=?,password_hash=?,version=version+1 WHERE id=? AND version=? RETURNING id,email,version")
      .bind(input.email, passwordHash, account.id, account.version).first<Admin>();
    if (!updated) throw new AppError("Seu acesso mudou. Entre novamente e tente outra vez.", 409);
    await db().prepare("DELETE FROM admin_sessions WHERE admin_id=? AND version<?").bind(account.id, updated.version).run();
    return await signedIn(req, updated);
  } catch (error) { return failure(error); }
}
