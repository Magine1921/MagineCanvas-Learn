import { existsSync } from 'fs';
import { basename, join } from 'path';

export type AgentShellInvocation = {
  executable: string;
  argsPrefix: string[];
  label: 'bash' | 'powershell';
};

function invocationFor(executable: string): AgentShellInvocation {
  const name = basename(executable).toLowerCase();
  if (name.includes('powershell') || name === 'pwsh.exe' || name === 'pwsh') {
    return {
      executable,
      argsPrefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'],
      label: 'powershell',
    };
  }
  return { executable, argsPrefix: ['-lc'], label: 'bash' };
}

export function resolveAgentShell(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): AgentShellInvocation {
  const configured = env.MAGINE_AGENT_SHELL?.trim();
  if (configured && existsSync(configured)) return invocationFor(configured);

  if (platform !== 'win32') return invocationFor('/bin/bash');

  const gitBashCandidates = [
    env.ProgramFiles ? join(env.ProgramFiles, 'Git', 'bin', 'bash.exe') : '',
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe') : '',
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : '',
  ].filter(Boolean);
  const gitBash = gitBashCandidates.find((candidate) => existsSync(candidate));
  if (gitBash) return invocationFor(gitBash);

  const powerShellCandidates = [
    env.ProgramFiles ? join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe') : '',
    env.SystemRoot
      ? join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : '',
    'powershell.exe',
  ].filter(Boolean);
  const powerShell =
    powerShellCandidates.find((candidate) => candidate === 'powershell.exe' || existsSync(candidate)) ||
    'powershell.exe';
  return invocationFor(powerShell);
}

export function buildAgentShellArgs(
  command: string,
  invocation: AgentShellInvocation,
): string[] {
  if (invocation.label === 'powershell') {
    const utf8Prefix =
      '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ';
    return [...invocation.argsPrefix, `${utf8Prefix}${command}`];
  }
  return [...invocation.argsPrefix, command];
}
