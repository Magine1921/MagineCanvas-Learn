import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      "prefer-const": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    files: [
      "src/app/pixi-demo/**",
      "src/app/playcanvas-demo/**",
      "src/components/canvas/pixi-canvas/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".open-next/**",
    ".cloudflare-trial-static/**",
    ".wrangler/**",
    "out/**",
    "build/**",
    "dist-installer/**",
    "dist-installer*/**",
    "dist-source/**",
    "electron/out/**",
    "public/ffmpeg/**",
    "public/ort/**",
    "vendor/**",
    ".magine-cache/**",
    "temp-find-line.js",
    "tmp_*.txt",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
