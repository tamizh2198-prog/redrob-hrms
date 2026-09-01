import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This migration deliberately keeps every ported page's existing
      // client-fetch-on-mount/dep-change pattern as-is (see the migration
      // plan: "not a rewrite into Server Components... keep the SPA-style
      // client-fetch pattern exactly as today") rather than restructuring
      // ~20 modules' worth of pages around this newer, stricter rule.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CJS by convention (next/jest's documented setup) — Jest doesn't
    // resolve an ESM config without extra flags.
    "jest.config.js",
  ]),
]);

export default eslintConfig;
