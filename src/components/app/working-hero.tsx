import { ReduceMark } from "@/components/app/reduce-mark";

/** Shown in the middle pane while a subject's first explainer is being made. */
export function WorkingHero({ subject }: { subject: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <ReduceMark className="mb-6 h-36 w-full" />
        <h2 className="text-xl font-semibold tracking-tight text-neutral-100">Reading {subject}&apos;s last twenty earnings calls</h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-300">
          Each call is studied on its own first — the numbers, the guidance, what management said and how they said it. Then the
          five years are drawn together into one explainer built around how the story actually changed.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-neutral-500">
          This takes about half an hour. Come back then — the page updates itself when it&apos;s ready.
        </p>
      </div>
    </div>
  );
}
