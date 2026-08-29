import { createStackAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { logoutAction } from "@/app/login/actions";
import { SmokeRunner } from "@/app/smoke/smoke-runner";
import { deployTarget } from "@/lib/anthropic";
import { listSmokeSessions } from "@/lib/smoke/session";
import { findSmokeStack } from "@/lib/smoke/stack";
import { checkStorage } from "@/lib/smoke/storage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const target = deployTarget();
  const stack = await findSmokeStack(target);
  const [sessions, storage] = await Promise.all([
    stack.agent ? listSmokeSessions(stack.agent.id) : Promise.resolve([]),
    checkStorage(),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <header>
        <h1 className="text-xl font-semibold">transcripts.fyi</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Managed Agents smoke</span>
          <Badge variant="outline">{target}</Badge>
          <form action={logoutAction}>
            <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground">log out</Button>
          </form>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle>Storage</CardTitle></CardHeader>
        <CardContent>
          <Table className="font-mono text-xs">
            <TableBody>
              {storage.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="text-muted-foreground">{c.name}</TableCell>
                  <TableCell className={c.ok ? "" : "text-destructive"}>{c.ok ? "OK" : "FAIL"} · {c.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Stack</CardTitle></CardHeader>
        <CardContent className="space-y-3">
        <Table className="font-mono text-xs">
          <TableBody>
            <Row k="environment" v={stack.environment?.id ?? null} />
            <Row k="skill" v={stack.skill ? `${stack.skill.id}  ${stack.skill.version}` : null} />
            <Row k="agent" v={stack.agent ? `${stack.agent.id}  v${stack.agent.version}${stack.agent.toolsCurrent ? "" : "  (tools out of date)"}` : null} />
          </TableBody>
        </Table>
        {(!stack.agent || !stack.agent.toolsCurrent) && (
          <form action={createStackAction}>
            <Button type="submit">
              {stack.agent ? `Update smoke agent (${target}) → new version` : `Create smoke agent (${target})`}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              find-or-create environment, skill, agent — tagged metadata.target={target}
            </p>
          </form>
        )}
        </CardContent>
      </Card>

      {stack.agent?.toolsCurrent && (
        <>
          <SmokeRunner target={target} />

          <Card>
            <CardHeader><CardTitle>Recent sessions</CardTitle></CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">none yet</p>
              ) : (
                <Table className="font-mono text-xs">
                  <TableBody>
                    {sessions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <a className="underline" href={`https://platform.claude.com/workspaces/default/sessions/${s.id}`} target="_blank" rel="noreferrer">
                            {s.id}
                          </a>
                        </TableCell>
                        <TableCell>{s.status}{s.archived ? " (archived)" : ""}</TableCell>
                        <TableCell>${(s.listCostCents / 100).toFixed(2)}</TableCell>
                        <TableCell className="text-muted-foreground">{s.created_at.replace("T", " ").slice(0, 19)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{k}</TableCell>
      <TableCell>{v ?? <span className="text-muted-foreground/60">— not found —</span>}</TableCell>
    </TableRow>
  );
}
