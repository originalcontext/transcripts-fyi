/** GC CLI.  npm run gc   |   npm run gc -- --apply   (cron: /api/cron/gc daily) */
import { gc } from "@/lib/ops/gc";

gc({ apply: process.argv.includes("--apply") }).then((r) => {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
});
