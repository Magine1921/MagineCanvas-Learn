/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // 主题变量已在 globals.css 中通过 @theme inline 定义
      // 这里可以添加额外的扩展配置
    },
  },
  plugins: [],
  // 启用 TailwindCSS v4 的实验性功能
  experimental: {
    optimizeUniversalDefaults: true,
  },
}