// EitanGD Gacha: "api" Edge Function.
// Handles everything that needs the service-role key: signup, login (lockout, captcha,
// email 2FA), sessions, password changes, and the admin's "log in as" and "set password".
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TURNSTILE_SECRET   Cloudflare Turnstile secret key            (required)
//   BREVO_API_KEY      Brevo API key, used to email 2FA codes     (required for 2FA)
//   MAIL_FROM          Verified sender address in Brevo           (required for 2FA)
//   ALLOWED_ORIGINS    e.g. https://you.github.io,http://localhost:8000
//   INTERNAL_EMAIL_DOMAIN  optional, default users.eitangd.invalid
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy with "Verify JWT" turned OFF for this function: login and signup are called
// before the user has a token, and every protected action checks the token itself.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "";
const EMAIL_DOMAIN = Deno.env.get("INTERNAL_EMAIL_DOMAIN") ?? "users.eitangd.invalid";
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const admin: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const RESERVED = new Set(["admin", "administrator", "moderator", "mod", "staff", "system", "root", "support",
  "eitangd", "robtop", "null", "undefined", "owner", "official", "server"]);

class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

// ---------------- helpers ----------------
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const ok = ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : (ORIGINS[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new HttpError(400, error.message);
  return data as T;
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
  return JSON.parse(json);
}

function randomCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, "0");
}

async function verifyCaptcha(token: unknown, ip: string) {
  if (!TURNSTILE_SECRET) throw new HttpError(500, "Captcha is not configured on the server");
  if (typeof token !== "string" || !token) throw new HttpError(400, "Please complete the captcha");
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip });
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new HttpError(400, "Captcha failed, please try again");
}

async function sendCode(to: string, code: string, purpose: "login" | "setup") {
  if (!BREVO_API_KEY || !MAIL_FROM) throw new HttpError(500, "Email 2FA is not configured on the server");
  const what = purpose === "login" ? "log in to" : "turn on 2FA for";
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: MAIL_FROM, name: "EitanGD Gacha" },
      to: [{ email: to }],
      subject: `Your EitanGD Gacha code: ${code}`,
      textContent: `Your code to ${what} EitanGD Gacha is ${code}. It expires in 10 minutes. If this wasn't you, change your password.`,
      htmlContent: `<p>Your code to ${what} <b>EitanGD Gacha</b> is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If this wasn't you, change your password.</p>`,
    }),
  });
  if (!r.ok) throw new HttpError(502, "Could not send the email code. Try again later.");
}

function maskEmail(e: string) { return e.replace(/^(.).*(@.*)$/, "$1***$2"); }

function checkPassword(pw: unknown, username?: string): string {
  if (typeof pw !== "string") throw new HttpError(400, "Password is required");
  if (pw.length < 10) throw new HttpError(400, "Password must be at least 10 characters");
  if (pw.length > 128) throw new HttpError(400, "Password is too long");
  if (username && pw.toLowerCase().includes(username.toLowerCase())) throw new HttpError(400, "Password must not contain your username");
  return pw;
}

// Have I Been Pwned, k-anonymity: only the first 5 hex chars of the SHA-1 leave the server.
async function pwned(pw: string): Promise<boolean> {
  try {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw))))
      .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const r = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { "Add-Padding": "true" } });
    if (!r.ok) return false;
    const text = await r.text();
    return text.split("\n").some((line) => {
      const [suffix, count] = line.trim().split(":");
      return suffix === hash.slice(5) && Number(count) > 0;
    });
  } catch { return false; }
}

// The caller's verified identity (token checked by Supabase Auth, session checked in our table).
async function requireUser(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Signed out");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Signed out");
  const sid = String(decodeJwt(token).session_id ?? "");
  const ok = await rpc<boolean>("srv_session_ok", { p_user: data.user.id, p_session: sid });
  if (!ok) throw new HttpError(401, "Signed out");
  const { data: s } = await admin.from("app_sessions").select("impersonated_by").eq("session_id", sid).maybeSingle();
  return { id: data.user.id, sid, token, impersonated: !!(s && s.impersonated_by) };
}

// Password and 2FA belong to the player only, not to an admin viewing their account.
async function requireOwner(req: Request) {
  const u = await requireUser(req);
  if (u.impersonated) throw new HttpError(403, "Not available while you are logged in as another player");
  return u;
}

async function requireAdmin(req: Request) {
  const u = await requireUser(req);
  const ok = await rpc<boolean>("srv_is_admin", { p_user: u.id, p_session: u.sid });
  if (!ok) throw new HttpError(403, "Not allowed");
  return u;
}

// Creates a real Supabase session for a user without a password (admin magic link → verify).
async function issueSession(userId: string, twofa: boolean, ip: string, ua: string, impersonatedBy: string | null = null) {
  const email = await rpc<string>("srv_user_email", { p_user: userId });
  if (!email) throw new HttpError(404, "User not found");
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new HttpError(500, "Could not start a session");
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: e2 } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (e2 || !v.session) throw new HttpError(500, "Could not start a session" + (e2 ? `: ${e2.message}` : ""));
  const sid = String(decodeJwt(v.session.access_token).session_id ?? "");
  await rpc("srv_register_session", { p_session: sid, p_user: userId, p_twofa: twofa, p_imp: impersonatedBy, p_ip: ip, p_ua: ua });
  return { access_token: v.session.access_token, refresh_token: v.session.refresh_token, expires_at: v.session.expires_at };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- actions ----------------
type Ctx = { req: Request; body: Record<string, any>; ip: string; ua: string };

const actions: Record<string, (c: Ctx) => Promise<unknown>> = {
  async signup({ body, ip, ua }) {
    await verifyCaptcha(body.captcha, ip);
    if (await rpc("srv_locked", { p_key: "signup:" + ip })) throw new HttpError(429, "Too many accounts from your network. Try later.");
    const username = String(body.username ?? "").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new HttpError(400, "Username: 3–20 letters, numbers or _");
    if (RESERVED.has(username.toLowerCase())) throw new HttpError(400, "That username is not allowed");
    const password = checkPassword(body.password, username);
    if (await pwned(password)) throw new HttpError(400, "That password appeared in a data breach. Pick another one.");
    if (await rpc<boolean>("srv_username_taken", { p_username: username })) throw new HttpError(409, "That username is taken");

    const { data, error } = await admin.auth.admin.createUser({
      email: `${username.toLowerCase()}@${EMAIL_DOMAIN}`, password, email_confirm: true, user_metadata: { username },
    });
    if (error || !data.user) throw new HttpError(409, "That username is taken");
    try {
      await rpc("srv_create_profile", { p_user: data.user.id, p_username: username });
    } catch (e) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw new HttpError(409, "That username is taken");
    }
    await rpc("srv_fail", { p_key: "signup:" + ip, p_max: 5, p_window: "1 hour", p_base_lock: "1 hour", p_max_lock: "1 hour" });
    await rpc("srv_log_login", { p_user: data.user.id, p_username: username, p_ok: true, p_reason: "signup", p_ip: ip, p_ua: ua });
    return { session: await issueSession(data.user.id, false, ip, ua) };
  },

  async login({ body, ip, ua }) {
    const started = Date.now();
    try {
      await verifyCaptcha(body.captcha, ip);
      const r = await rpc<Record<string, any>>("srv_login", {
        p_username: String(body.username ?? ""), p_password: String(body.password ?? ""), p_ip: ip, p_ua: ua,
      });
      if (r.error === "locked") {
        const mins = Math.max(1, Math.ceil((new Date(r.until).getTime() - Date.now()) / 60000));
        throw new HttpError(429, `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
      }
      if (r.error === "banned") {
        throw new HttpError(403, "This account is banned", { banned: true, reason: r.reason, until: r.until });
      }
      if (r.error) throw new HttpError(401, "Invalid username or password");

      if (r.twofa) {
        const code = randomCode();
        const challenge = await rpc<string>("srv_new_challenge", {
          p_user: r.userId, p_purpose: "login", p_email: r.twofaEmail, p_code: code, p_ip: ip, p_ua: ua,
        });
        await sendCode(r.twofaEmail, code, "login");
        return { twofa: true, challenge, email: maskEmail(r.twofaEmail) };
      }
      await rpc("srv_log_login", { p_user: r.userId, p_username: r.username, p_ok: true, p_reason: "password", p_ip: ip, p_ua: ua });
      return { session: await issueSession(r.userId, false, ip, ua), needsTwofa: r.role === "admin" };
    } finally {
      // Every login answer takes at least ~700 ms, so timing reveals nothing.
      const wait = 700 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }
  },

  async verify2fa({ body, ip, ua }) {
    if (await rpc("srv_locked", { p_key: "2fa:" + ip })) throw new HttpError(429, "Too many attempts. Try again later.");
    const r = await rpc<Record<string, any>>("srv_check_challenge", {
      p_id: String(body.challenge ?? ""), p_code: String(body.code ?? "").trim(), p_purpose: "login",
    }).catch((): Record<string, any> => ({ error: "expired" }));
    if (r.error) {
      await rpc("srv_fail", { p_key: "2fa:" + ip, p_max: 20, p_window: "10 minutes", p_base_lock: "15 minutes", p_max_lock: "1 hour" });
      if (r.error === "wrong") throw new HttpError(401, `Wrong code (${r.left} tr${r.left === 1 ? "y" : "ies"} left)`);
      throw new HttpError(401, "This code expired. Log in again.");
    }
    await rpc("srv_log_login", { p_user: r.userId, p_username: null, p_ok: true, p_reason: "password + email 2FA", p_ip: ip, p_ua: ua });
    return { session: await issueSession(r.userId, true, ip, ua) };
  },

  async twofaStart({ req, body, ip, ua }) {
    const u = await requireOwner(req);
    const email = String(body.email ?? "").trim();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "Enter a valid email address");
    const code = randomCode();
    const challenge = await rpc<string>("srv_new_challenge", { p_user: u.id, p_purpose: "setup", p_email: email, p_code: code, p_ip: ip, p_ua: ua });
    await sendCode(email, code, "setup");
    return { challenge, email: maskEmail(email) };
  },

  async twofaConfirm({ req, body }) {
    const u = await requireOwner(req);
    const r = await rpc<Record<string, any>>("srv_check_challenge", {
      p_id: String(body.challenge ?? ""), p_code: String(body.code ?? "").trim(), p_purpose: "setup",
    }).catch((): Record<string, any> => ({ error: "expired" }));
    if (r.error === "wrong") throw new HttpError(401, `Wrong code (${r.left} left)`);
    if (r.error || r.userId !== u.id) throw new HttpError(401, "This code expired. Start again.");
    await rpc("srv_set_twofa", { p_user: u.id, p_email: r.email });
    await rpc("srv_mark_twofa", { p_session: u.sid });   // this session just proved the email
    return { ok: true };
  },

  async twofaDisable({ req, body }) {
    const u = await requireOwner(req);
    const p = await rpc<Record<string, any>>("srv_profile", { p_user: u.id });
    if (p.role === "admin") throw new HttpError(400, "Admins must keep 2FA on");
    if (!(await rpc<boolean>("srv_check_password", { p_user: u.id, p_password: String(body.password ?? "") }))) {
      throw new HttpError(401, "Wrong password");
    }
    await rpc("srv_set_twofa", { p_user: u.id, p_email: null });
    return { ok: true };
  },

  async changePassword({ req, body }) {
    const u = await requireOwner(req);
    if (await rpc("srv_locked", { p_key: "pw:" + u.id })) throw new HttpError(429, "Too many attempts. Try again later.");
    if (!(await rpc<boolean>("srv_check_password", { p_user: u.id, p_password: String(body.current ?? "") }))) {
      await rpc("srv_fail", { p_key: "pw:" + u.id, p_max: 5, p_window: "15 minutes", p_base_lock: "5 minutes", p_max_lock: "1 hour" });
      throw new HttpError(401, "Current password is wrong");
    }
    const p = await rpc<Record<string, any>>("srv_profile", { p_user: u.id });
    const pw = checkPassword(body.password, p.username);
    if (await pwned(pw)) throw new HttpError(400, "That password appeared in a data breach. Pick another one.");
    const { error } = await admin.auth.admin.updateUserById(u.id, { password: pw });
    if (error) throw new HttpError(400, error.message);
    await rpc("srv_after_password_reset", { p_user: u.id, p_admin: null }); // logs out every device
    return { ok: true };
  },

  async logout({ req }) {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (token) {
      try {
        const sid = String(decodeJwt(token).session_id ?? "");
        await admin.auth.admin.signOut(token, "local");
        if (sid) await admin.from("app_sessions").delete().eq("session_id", sid);
      } catch { /* already gone */ }
    }
    return { ok: true };
  },

  // ----- admin -----
  async impersonate({ req, body, ip, ua }) {
    const a = await requireAdmin(req);
    const target = String(body.userId ?? "");
    if (!target || target === a.id) throw new HttpError(400, "Pick another player");
    await rpc("srv_log_admin", { p_admin: a.id, p_action: "impersonate", p_target: target });
    return { session: await issueSession(target, false, ip, ua, a.id) };
  },

  async adminSetPassword({ req, body }) {
    const a = await requireAdmin(req);
    const target = String(body.userId ?? "");
    const pw = String(body.password ?? "");
    if (pw.length < 8 || pw.length > 128) throw new HttpError(400, "Password must be 8–128 characters");
    const { error } = await admin.auth.admin.updateUserById(target, { password: pw });
    if (error) throw new HttpError(400, error.message);
    await rpc("srv_after_password_reset", { p_user: target, p_admin: a.id });
    return { ok: true };
  },
};

Deno.serve(async (req) => {
  const headers = { ...cors(req), "content-type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  const origin = req.headers.get("origin");
  if (ORIGINS.length && origin && !ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers });
  }
  try {
    const raw = await req.text();
    if (raw.length > 10_000) throw new HttpError(413, "Request too large");
    const body = raw ? JSON.parse(raw) : {};
    const fn = actions[String(body.action ?? "")];
    if (!fn) throw new HttpError(404, "Unknown action");
    const result = await fn({ req, body, ip: clientIp(req), ua: (req.headers.get("user-agent") ?? "").slice(0, 300) });
    if (Math.random() < 0.02) rpc("srv_cleanup", {}).catch(() => {});
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof HttpError ? e.message : "Server error";
    if (!(e instanceof HttpError)) console.error(e);
    return new Response(JSON.stringify({ error: message, ...(e instanceof HttpError ? e.extra : {}) }), { status, headers });
  }
});
