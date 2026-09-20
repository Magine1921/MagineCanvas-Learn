import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isCloudflareBuild = process.env.MAGINE_CLOUDFLARE_BUILD === "1";

const localAgentTraceExcludes = [
  "src/**",
  "public/**",
  "scripts/**",
  "vendor/**",
  "build/**",
  ".git/**",
  ".gitignore",
  ".magine-cache/**",
  "canvas-learn/**",
  "canvas-clean/**",
  "license-cloudflare/**",
  "delivery-staging/**",
  "dist-installer*/**",
  "electron/out/**",
  "next.config.ts",
  "nul",
  "*.md",
  "*.png",
  "*.yaml",
  "*.yml",
  "*.log",
  "*.txt",
  "*.zip",
  "*.cmd",
  "*.ps1",
  "*.json",
  "*.mjs",
  "*.cjs",
  "*.js",
  "*.tsbuildinfo",
  "*.code-workspace",
];

/**
 * Windows: plain `npx next dev` (Turbopack) can return 500 while processing `src/app/globals.css`
 * (TurbopackInternalError reading the reserved path `…\\nul`). Use `npm run dev` (`--webpack`).
 * Opt into Turbopack via `npm run dev:turbo` on platforms where it is stable.
 *
 * 生产/Electron：PostCSS 插件 `postcss-backdrop-filter-fix` 补全标准 `backdrop-filter`
 * （Turbopack/Lightning CSS 打包后常只剩 `-webkit-backdrop-filter`，Electron 内磨砂会失效）。
 */
const nextConfig: NextConfig = {
  /** 供 Electron 安装包内嵌 Next 服务（无需用户单独安装 Node） */
  output: "standalone",
  /** 限制 standalone 文件追踪范围，避免 webpack 在 Windows 上扫到 Application Data 触发 EPERM */
  outputFileTracingRoot: projectRoot,
  outputFileTracingExcludes: {
    "/*": localAgentTraceExcludes,
    "/api/agent/file": localAgentTraceExcludes,
    "/api/agent/terminal": localAgentTraceExcludes,
  },
  /** Electron dev 用 127.0.0.1 加载时允许 HMR / 字体等 dev 资源 */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  /** Local STT uses a native Node addon; keep it external to Next's server bundle. */
  serverExternalPackages: ["sherpa-onnx-node"],
  ...(isCloudflareBuild
    ? {
        turbopack: {
          resolveAlias: {
            sharp: "./src/lib/cloudflare-sharp-stub.ts",
          },
        },
      }
    : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
