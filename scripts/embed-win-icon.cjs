/**
 * electron-builder afterPack:
 * 1. Embed the Windows icon without invoking electron-builder's signing helper.
 * 2. Flip Electron security fuses before optional code signing.
 */
module.exports = async function hardenWindowsPackage(context) {
  if (context.electronPlatformName !== 'win32') return;

  const fs = require('fs');
  const path = require('path');
  const { spawnSync } = require('child_process');

  const projectDir = context.packager.projectDir;
  const exe = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  if (!fs.existsSync(exe)) {
    throw new Error(`[package-hardening] executable not found: ${exe}`);
  }

  const iconPath = path.join(projectDir, 'build', 'icon.ico');
  const rceditExe = path.join(
    projectDir,
    'node_modules',
    'rcedit',
    'bin',
    process.arch === 'x64' || process.arch === 'arm64'
      ? 'rcedit-x64.exe'
      : 'rcedit.exe',
  );
  if (fs.existsSync(iconPath) && fs.existsSync(rceditExe)) {
    const result = spawnSync(rceditExe, [exe, '--set-icon', iconPath], {
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(
        `[package-hardening] rcedit failed with exit code ${result.status ?? 'unknown'}`,
      );
    }
    console.log('[package-hardening] Windows icon embedded:', exe);
  } else {
    console.warn('[package-hardening] icon or rcedit missing; icon embedding skipped');
  }

  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  await flipFuses(exe, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
  console.log('[package-hardening] Electron security fuses applied:', exe);
};
