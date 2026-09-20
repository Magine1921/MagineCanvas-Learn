function unsupportedSharp(): never {
  throw new Error('Cloudflare 运行时不支持本地原生 Sharp 图像处理，请在桌面端执行此操作');
}

export default unsupportedSharp;
