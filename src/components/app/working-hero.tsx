/**
 * Shown in the middle pane while a subject's first explainer is being made.
 * Twenty bars (the quarters) resolve into one arc (the story); a light sweep
 * crosses them so the page reads as "in progress" without a spinner.
 */
export function WorkingHero({ subject }: { subject: string }) {
  const bars = Array.from({ length: 20 }, (_, i) => 18 + Math.round(26 * Math.pow(i / 19, 1.6)) + (i % 3 === 1 ? 6 : 0));
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <svg viewBox="0 0 320 120" className="mb-6 h-32 w-full" role="img" aria-label="Twenty quarters becoming one story">
          <defs>
            <linearGradient id="sweep" x1="0" x2="1">
              <stop offset="0" stopColor="#7dd3fc" stopOpacity="0" />
              <stop offset="0.5" stopColor="#7dd3fc" stopOpacity="0.55" />
              <stop offset="1" stopColor="#7dd3fc" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="arc" x1="0" x2="1">
              <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.2" />
              <stop offset="1" stopColor="#7dd3fc" />
            </linearGradient>
          </defs>
          {bars.map((h, i) => (
            <rect key={i} x={14 + i * 15} y={104 - h} width="9" height={h} rx="2" fill="#262626" />
          ))}
          <path
            d={`M 18 ${104 - bars[0]} ${bars.map((h, i) => `L ${18.5 + i * 15} ${104 - h - 6}`).join(" ")}`}
            fill="none"
            stroke="url(#arc)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="-80" y="0" width="80" height="120" fill="url(#sweep)" className="working-sweep" />
        </svg>
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
