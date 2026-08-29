import { redirect } from "next/navigation";

import { Shell } from "@/components/app/shell";
import { firstSubjectKey } from "@/lib/distill/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const first = await firstSubjectKey();
  if (first) redirect(`/s/${first}`);
  return (
    <Shell>
      <main className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        Add a ticker to start.
      </main>
    </Shell>
  );
}
