import type { Metadata } from "next";

import { LoginForm } from "@/app/login/login-form";
import { ReduceMark } from "@/components/app/reduce-mark";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>;
}) {
  const { next = "/", invite = "" } = await searchParams;
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 py-12">
      {/* Backdrop: a soft accent glow from the top edge and a dot grid that fades out toward the corners. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(125,211,252,0.13),transparent)]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:radial-gradient(ellipse_60%_55%_at_50%_45%,black,transparent)]"
      />

      <div className="relative w-full max-w-sm animate-in fade-in slide-in-from-bottom-3 duration-700 ease-out">
        <ReduceMark className="mx-auto mb-8 h-32 w-full max-w-xs drop-shadow-[0_0_24px_rgba(125,211,252,0.22)]" />

        <div className="mb-8 text-center">
          <p className="mb-3 font-mono text-[11px] tracking-[0.22em] text-sky-300/90 uppercase">transcripts.fyi</p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Quickly understand a company through its calls.</h1>
          <p className="mt-2 text-sm leading-relaxed text-balance text-muted-foreground">
            Twenty quarters, analyzed independently, distilled into one interactive explainer.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/50 backdrop-blur-sm">
          <LoginForm next={next} invite={invite} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">Private preview · invite only</p>
      </div>
    </main>
  );
}
