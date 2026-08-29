import { type ClassValue,clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", … No deps, no locale. */
export function timeAgo(date: Date, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000))
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return plural(m, "minute")
  const h = Math.round(m / 60)
  if (h < 24) return plural(h, "hour")
  const d = Math.round(h / 24)
  if (d === 1) return "yesterday"
  if (d < 30) return plural(d, "day")
  const mo = Math.round(d / 30)
  if (mo < 12) return plural(mo, "month")
  return plural(Math.round(d / 365), "year")
}
