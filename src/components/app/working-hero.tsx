/**
 * Shown in the middle pane while a subject's first explainer is being made.
 * Twenty small documents (one per call, read on their own) feed one explainer
 * below — the map and the reduce. The only motion: the connecting lines pulse
 * down toward the explainer, each on its own beat.
 */
export function WorkingHero({ subject }: { subject: string }) {
  const docs = Array.from({ length: 20 }, (_, i) => 12 + i * 15);
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <svg viewBox="0 0 320 132" className="mb-6 h-36 w-full" role="img" aria-label="Twenty calls read separately, then combined into one explainer">
          {docs.map((x, i) => (
            <g key={i}>
              <rect x={x} y="8" width="10" height="13" rx="1.5" fill="#171717" stroke="#3f3f46" strokeWidth="1" />
              <line x1={x + 2.5} y1="12" x2={x + 7.5} y2="12" stroke="#52525b" strokeWidth="1" />
              <line x1={x + 2.5} y1="15" x2={x + 7.5} y2="15" stroke="#52525b" strokeWidth="1" />
              <line x1={x + 2.5} y1="18" x2={x + 6} y2="18" stroke="#52525b" strokeWidth="1" />
              <path
                d={`M ${x + 5} 24 C ${x + 5} 44, 160 40, 160 62`}
                fill="none"
                stroke="#7dd3fc"
                strokeWidth="0.9"
                className="working-line"
                style={{ animationDelay: `${(i * 0.17) % 2.4}s` }}
              />
            </g>
          ))}
          <rect x="100" y="66" width="120" height="58" rx="4" fill="#0f0f0f" stroke="#7dd3fc" strokeOpacity="0.6" strokeWidth="1.2" />
          <line x1="110" y1="78" x2="170" y2="78" stroke="#e5e5e5" strokeWidth="1.6" />
          <line x1="110" y1="86" x2="200" y2="86" stroke="#52525b" strokeWidth="1" />
          <line x1="110" y1="92" x2="188" y2="92" stroke="#52525b" strokeWidth="1" />
          <polyline points="110,116 126,112 142,113 158,106 174,104 190,98 206,100" fill="none" stroke="#7dd3fc" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
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
