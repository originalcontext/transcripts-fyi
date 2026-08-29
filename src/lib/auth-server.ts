import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";

/** Is the current request's viewer an admin? (Everyone, while ADMIN_INVITE_CODE is unset.) */
export async function viewerIsAdmin() {
  return isAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
}

/** Server-action / route guard for the CMA-backed, cost-bearing surfaces. */
export async function requireAdmin() {
  if (!(await viewerIsAdmin())) throw new Error("admin only");
}
