import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { "simple-import-sort": simpleImportSort, "unused-imports": unusedImports },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The line: only the CMA side may touch the Anthropic client. Pages, components and
    // mainline actions read Postgres only. Add a directory here only with a reason.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/cma/**", "src/lib/distill/**", "src/lib/ops/**", "src/lib/smoke/**", "src/app/webhook/**", "src/lib/anthropic.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@/lib/anthropic", importNames: ["anthropic"], message: "Mainline code reads Postgres only; CMA access lives under lib/cma, lib/distill, lib/ops, lib/smoke and app/webhook." }] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**"]),
]);

export default eslintConfig;
