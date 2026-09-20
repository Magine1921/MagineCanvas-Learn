// 清除可能泄漏的 ELECTRON_RUN_AS_NODE，确保 Electron 正常启动
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require('child_process');
const electronPath = require('electron');
const args = process.argv.slice(2);

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: { ...process.env },
  windowsHide: false,
});

child.on('close', (code) => process.exit(code));
