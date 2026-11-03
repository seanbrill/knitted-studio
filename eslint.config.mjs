import tseslint from "typescript-eslint";
import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Desktop-readiness rule 3: rendering sits behind the Renderer interface, so
// Playwright and Electron are importable only where they belong. A route
// handler that imports Playwright at the top level breaks the static site,
// the standalone server trace, and every machine without a browser installed.
const BANNED = [
  { name: "playwright", message: "Only packages/engine and scripts may import Playwright. Go through the Renderer interface." },
  { name: "playwright-core", message: "Only packages/engine and scripts may import Playwright. Go through the Renderer interface." },
  { name: "electron", message: "Only apps/studio/electron may import Electron." },
];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/out/**", "dist/**", "claude-workspace/**", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-restricted-imports": ["error", { paths: BANNED }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/**/*.{ts,tsx}"],
    plugins: { "@next/next": next, "react-hooks": reactHooks },
    rules: { ...next.configs.recommended.rules, ...next.configs["core-web-vitals"].rules, ...reactHooks.configs.recommended.rules,
      // App Router only: there is no pages/ directory for this rule to inspect.
      "@next/next/no-html-link-for-pages": "off",
      // Our images are local files and thumbnails we generated ourselves; the
      // next/image optimiser would add a network hop and a cache for nothing.
      "@next/next/no-img-element": "off" },
  },
  // The two places allowed to touch them.
  { files: ["packages/engine/**", "scripts/**", "test/**", "apps/studio/electron/**"], rules: { "no-restricted-imports": "off" } },
);
