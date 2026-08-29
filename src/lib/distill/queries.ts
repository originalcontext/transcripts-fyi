import { and, desc, eq, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export async function listUniverse() {
  // One row per subject with whether any artifact exists — drives the sidebar's greyed state.
  return db
    .select({
      id: schema.subjects.id,
      key: schema.subjects.key,
      displayName: schema.subjects.displayName,
      hasArtifact: sql<boolean>`exists (select 1 from ${schema.artifacts} a where a.subject_id = ${schema.subjects}.id)`,
      working: sql<boolean>`exists (select 1 from ${schema.runs} r where r.subject_id = ${schema.subjects}.id and r.status = 'working')`,
    })
    .from(schema.subjects)
    .orderBy(schema.subjects.key);
}

export async function getSubject(kind: string, key: string) {
  const [s] = await db
    .select()
    .from(schema.subjects)
    .where(and(eq(schema.subjects.kind, kind), eq(schema.subjects.key, key)));
  return s ?? null;
}

/** Sidebar/redirect helper: the first subject key, or null. */
export async function firstSubjectKey() {
  const [s] = await db.select({ key: schema.subjects.key }).from(schema.subjects).orderBy(schema.subjects.key).limit(1);
  return s?.key ?? null;
}

const subjectIdFor = (kind: string, key: string) =>
  db.select({ id: schema.subjects.id }).from(schema.subjects).where(and(eq(schema.subjects.kind, kind), eq(schema.subjects.key, key)));

/** Latest artifact for a subject addressed by (kind, key) — no prior lookup round. */
export async function latestArtifactFor(kind: string, key: string) {
  const [a] = await db
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.subjectId, subjectIdFor(kind, key)))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  return a ?? null;
}

/** Live run for a subject addressed by (kind, key). */
export async function activeRunFor(kind: string, key: string, skill: string) {
  const [r] = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectIdFor(kind, key)), eq(schema.runs.skill, skill), ne(schema.runs.status, "ended")))
    .orderBy(desc(schema.runs.createdAt))
    .limit(1);
  return r ?? null;
}

export async function activeRun(subjectId: string, skill: string) {
  const [r] = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectId), eq(schema.runs.skill, skill), ne(schema.runs.status, "ended")))
    .orderBy(desc(schema.runs.createdAt))
    .limit(1);
  return r ?? null;
}
