import type { Metadata } from "next";
import { ElectronInit } from "@/components/electron/ElectronInit";
import { DesktopSettingsBootstrap } from "@/components/electron/DesktopSettingsBootstrap";
import { DesktopUpdateHost } from "@/components/electron/DesktopUpdateHost";
import "reactflow/dist/style.css";
import "@reactflow/node-resizer/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magine Canvas - AI Workflow Builder",
  description: "无限画布 AI 工作流与生成平台",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased dark"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(/Electron\\//.test(navigator.userAgent)||window.magineDesktop&&window.magineDesktop.isDesktop){document.documentElement.classList.add('mc-electron-no-entrance-blur');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <ElectronInit />
        <DesktopSettingsBootstrap />
        <DesktopUpdateHost />
        {children}
      </body>
    </html>
  );
}
