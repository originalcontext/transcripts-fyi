/** CLI twin of "Add to universe":  npm run distill -- NVDA */
import { deployTarget } from "@/lib/anthropic";
import { addSubject } from "@/lib/distill/runs";

addSubject(String(process.argv[2] ?? "").toUpperCase(), deployTarget()).then((s) => {
  console.log("subject", s.key, s.id);
  process.exit(0);
});
