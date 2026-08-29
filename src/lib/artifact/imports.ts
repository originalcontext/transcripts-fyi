/**
 * The fixed library set an explainer may use — "these and only these".
 * The app injects these tags into the artifact's <head> at render; the skill
 * documents the same list to the agent. One source of truth, pinned versions.
 */
export const ARTIFACT_LIBS = [
  {
    name: "Chart.js",
    global: "Chart",
    src: "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js",
    use: "line/bar charts of quarterly series; `new Chart(canvas, config)`",
  },
  {
    name: "Alpine.js",
    global: "Alpine",
    src: "https://cdn.jsdelivr.net/npm/alpinejs@3.16.3/dist/cdn.min.js",
    use: "tabs, toggles, click-to-expand via x-data / x-show / @click; no build step",
  },
  {
    name: "lucide",
    global: "lucide",
    src: "https://cdn.jsdelivr.net/npm/lucide@1.37.0/dist/umd/lucide.min.js",
    use: "icons: `<i data-lucide=\"chevron-down\"></i>` then `lucide.createIcons()`",
  },
] as const;

const tags = ARTIFACT_LIBS.map((l) => `<script src="${l.src}" crossorigin="anonymous"></script>`).join("\n");

/**
 * First thing in <head>: paint dark before the document's own CSS parses, so
 * the pane never flashes white. Then the libraries (Alpine deferred so x-data
 * elements exist before it boots).
 */
const FIRST_PAINT = `<meta name="color-scheme" content="dark"><style>html{background:#0a0a0a;color:#e5e5e5;color-scheme:dark}</style>`;
const ARTIFACT_HEAD = FIRST_PAINT + "\n" + tags.replace('<script src="https://cdn.jsdelivr.net/npm/alpinejs', '<script defer src="https://cdn.jsdelivr.net/npm/alpinejs');

/** Insert the library tags right after <head>; if the document has no <head>, prepend. */
export function injectArtifactHead(html: string): string {
  const i = html.search(/<head[^>]*>/i);
  if (i === -1) return `${ARTIFACT_HEAD}\n${html}`;
  const end = html.indexOf(">", i) + 1;
  return `${html.slice(0, end)}\n${ARTIFACT_HEAD}\n${html.slice(end)}`;
}
