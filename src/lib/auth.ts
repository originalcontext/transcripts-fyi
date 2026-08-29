/**
 * Invite-code auth — the simplest thing that works for a friends demo.
 *
 * One env var, INVITE_CODE, is both the gate and the secret: the session
 * cookie is HMAC(INVITE_CODE, "session-v1"), so it is stateless, needs no
 * table, and rotating the code logs everyone out. Web Crypto only, so the
 * same code runs in proxy.ts and in server actions.
 */

export const SESSION_COOKIE = "tfyi_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function inviteCode() {
  const code = process.env.INVITE_CODE;
  if (!code) throw new Error("INVITE_CODE is not set");
  return code;
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const sessionToken = () => hmac(inviteCode(), "session-v1");

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookieValue: string | undefined) {
  return !!cookieValue && timingSafeEqual(cookieValue, await sessionToken());
}

export function isValidInvite(submitted: string) {
  return timingSafeEqual(submitted.trim(), inviteCode()) || isAdminInvite(submitted);
}

/**
 * Admin gate for the heavy, CMA-backed "sausage" views. Set ADMIN_INVITE_CODE
 * to enable: logging in with it mints an extra admin cookie. Unset → everyone
 * is admin (today's friends-demo behavior).
 */
export const ADMIN_COOKIE = "tfyi_admin";

export const adminToken = () => hmac(process.env.ADMIN_INVITE_CODE ?? "", "admin-v1");

export function isAdminInvite(submitted: string) {
  const code = process.env.ADMIN_INVITE_CODE;
  return !!code && timingSafeEqual(submitted.trim(), code);
}

export async function isAdmin(cookieValue: string | undefined) {
  if (!process.env.ADMIN_INVITE_CODE) return true;
  return !!cookieValue && timingSafeEqual(cookieValue, await adminToken());
}

/** Same-origin post-login target only: one leading slash, no "//" and no backslash (URL parsers read "/\\x" as "//x"). */
export function safeNext(next: string): string {
  return /^\/(?![\/\\])[^\\]*$/.test(next) ? next : "/";
}
