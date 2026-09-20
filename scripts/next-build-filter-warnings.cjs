const { spawn } = require('child_process');
const path = require('path');

const nextCli = require.resolve('next/dist/bin/next');

function stripKnownNftWarning(text) {
  const marker = /Turbopack build encountered \d+ warnings?:\r?\n/g;
  const match = marker.exec(text);
  if (!match) return text;

  const warningSection = text.slice(match.index);
  const headings = [...warningSection.matchAll(/^\.\/[^\r\n]+$/gm)]
    .map(([heading]) => heading.replace(/:\d+:\d+$/, ''));
  const knownHeadings = new Set([
    './next.config.ts',
    './src/app/api/agent/file/route.ts',
    './src/app/api/agent/terminal/route.ts',
  ]);

  if (headings.length === 0 || headings.some((heading) => !knownHeadings.has(heading))) {
    return text;
  }
  return text.slice(0, match.index).trimEnd() + '\n';
}

function runBuild() {
  const child = spawn(process.execPath, [nextCli, 'build'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('close', (code) => {
    const filteredStdout = stripKnownNftWarning(stdout);
    const filteredStderr = stripKnownNftWarning(stderr);
    if (filteredStdout) process.stdout.write(filteredStdout);
    if (filteredStderr) process.stderr.write(filteredStderr);
    process.exit(code ?? 1);
  });
  child.on('error', (err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}

if (require.main === module) runBuild();

module.exports = { stripKnownNftWarning };
