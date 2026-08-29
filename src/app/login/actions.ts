"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_COOKIE, adminToken, isAdminInvite, isValidInvite, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!isValidInvite(code)) return { error: "That invite code didn't work." };

  const jar = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
  jar.set(SESSION_COOKIE, await sessionToken(), opts);
  if (isAdminInvite(code)) jar.set(ADMIN_COOKIE, await adminToken(), opts);
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ADMIN_COOKIE);
  redirect("/login");
}
