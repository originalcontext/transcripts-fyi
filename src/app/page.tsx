import { createStackAction } from "@/app/actions";
import { SmokeRunner } from "@/app/smoke-runner";
import { deployTarget } from "@/lib/anthropic";
import { listSmokeSessions } from "@/lib/smoke/session";
import { findStack } from "@/lib/smoke/stack";
import { checkStorage } from "@/lib/smoke/storage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const target = deployTarget();
  const stack = await findStack(target);
  const [sessions, storage] = await Promise.all([
    stack.agent ? listSmokeSessions(stack.agent.id) : Promise.resolve([]),
    checkStorage(),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <header>
        <h1 className="text-xl font-semibold">transcripts.fyi</h1>
        <p className="text-sm text-neutral-500">
          Managed Agents smoke · target <code className="font-mono">{target}</code>
        </p>
      </header>

      <section className="space-y-2 text-sm">
        <h2 className="font-medium">Storage</h2>
        <table className="w-full font-mono text-xs">
          <tbody>
            {storage.map((c) => (
              <tr key={c.name}>
                <td className="py-0.5 pr-4 text-neutral-500">{c.name}</td>
                <td className={`py-0.5 ${c.ok ? "" : "text-red-600"}`}>{c.ok ? "OK" : "FAIL"} · {c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="font-medium">Stack</h2>
        <table className="w-full font-mono text-xs">
          <tbody>
            <Row k="environment" v={stack.environment ? `${stack.environment.id}  ${stack.environment.name}` : null} />
            <Row k="skill" v={stack.skill ? `${stack.skill.id}  ${stack.skill.version}` : null} />
            <Row k="agent" v={stack.agent ? `${stack.agent.id}  v${stack.agent.version}${stack.agent.toolsCurrent ? "" : "  (tools out of date)"}` : null} />
          </tbody>
        </table>
        {(!stack.agent || !stack.agent.toolsCurrent) && (
          <form action={createStackAction}>
            <button className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black">
              {stack.agent ? `Update smoke agent (${target}) → new version` : `Create smoke agent (${target})`}
            </button>
            <p className="mt-1 text-xs text-neutral-500">
              find-or-create environment, skill, agent — tagged metadata.target={target}
            </p>
          </form>
        )}
      </section>

      {stack.agent?.toolsCurrent && (
        <>
          <SmokeRunner target={target} />

          <section className="space-y-2 text-sm">
            <h2 className="font-medium">Recent sessions</h2>
            {sessions.length === 0 ? (
              <p className="text-neutral-500">none yet</p>
            ) : (
              <table className="w-full font-mono text-xs">
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="py-1 pr-2">
                        <a className="underline" href={`https://platform.claude.com/workspaces/default/sessions/${s.id}`} target="_blank" rel="noreferrer">
                          {s.id}
                        </a>
                      </td>
                      <td className="py-1 pr-2">{s.status}{s.archived ? " (archived)" : ""}</td>
                      <td className="py-1 pr-2">${(s.listCostCents / 100).toFixed(2)}</td>
                      <td className="py-1 text-neutral-500">{s.created_at.replace("T", " ").slice(0, 19)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <tr>
      <td className="py-0.5 pr-4 text-neutral-500">{k}</td>
      <td className="py-0.5">{v ?? <span className="text-neutral-400">— not found —</span>}</td>
    </tr>
  );
}
