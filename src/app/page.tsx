import { redirect } from "next/navigation";
import { Shell } from "@/components/app/shell";
import { listUniverse } from "@/lib/distill/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const universe = await listUniverse();
  if (universe.length > 0) redirect(`/s/${universe[0].key}`);
  return (
    <Shell>
      <main className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        Add a ticker to start.
      </main>
    </Shell>
  );
}
