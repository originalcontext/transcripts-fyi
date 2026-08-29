import { count, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { key, redis } from "@/lib/redis";

export type StorageCheck = { name: string; ok: boolean; detail: string };

async function checkPostgres(): Promise<StorageCheck> {
  try {
    const { rows: [{ now }] } = await db.execute<{ now: string }>(sql`select now()::text as now`);
    const [{ n }] = await db.select({ n: count() }).from(schema.webhookEvents);
    const host = new URL(process.env.DATABASE_URL ?? "postgresql://x@unknown/").host;
    return { name: "postgres (neon http)", ok: true, detail: `${host} · now=${now} · webhook_events=${n}` };
  } catch (err) {
    return { name: "postgres (neon http)", ok: false, detail: errorMessage(err) };
  }
}

async function checkRedis(): Promise<StorageCheck> {
  try {
    const k = key("smoke", "hits");
    const hits = await redis.incr(k);
    const host = new URL(process.env.KV_REST_API_URL ?? "https://unknown").host;
    return { name: "redis (upstash rest)", ok: true, detail: `${host} · ${k}=${hits}` };
  } catch (err) {
    return { name: "redis (upstash rest)", ok: false, detail: errorMessage(err) };
  }
}

export const checkStorage = () => Promise.all([checkPostgres(), checkRedis()]);
