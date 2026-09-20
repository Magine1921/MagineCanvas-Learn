const MAX_COMMAND_LENGTH = 20_000;
const SECRET_NAME_PATTERN =
  /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY|ACCESS_?KEY|AUTH|COOKIE)(?:_|$)/i;

const BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /:\s*\(\)\s*\{[\s\S]*:\s*\|[\s\S]*&\s*\}\s*;?\s*:/,
    reason: '检测到 fork bomb',
  },
  {
    pattern: /\b(?:mkfs(?:\.\w+)?|fdisk|parted|diskpart)\b/i,
    reason: '禁止修改磁盘分区或文件系统',
  },
  {
    pattern: /\bdd\s+if=.*\s+of=(?:\/dev\/(?:sd|nvme|hd)|\\\\\.\\physicaldrive)/i,
    reason: '禁止直接写入物理磁盘',
  },
  {
    pattern: /\b(?:format(?:\.com)?\s+[a-z]:|cipher\s+\/w:)/i,
    reason: '禁止格式化或擦除磁盘',
  },
  {
    pattern: /\b(?:shutdown|reboot|halt|poweroff|stop-computer|restart-computer)\b/i,
    reason: '禁止关闭或重启系统',
  },
  {
    pattern: /\brm\s+-[^\r\n]*r[^\r\n]*f[^\r\n]*(?:\s+\/(?:\s|$)|\s+\/\*|\s+~(?:\s|$))/i,
    reason: '禁止递归删除系统根目录或用户主目录',
  },
  {
    pattern: /\bremove-item\b[^\r\n]*(?:-recurse|-r\b)[^\r\n]*(?:[a-z]:\\(?:\s|$)|\$env:systemroot|\\windows\\)/i,
    reason: '禁止递归删除磁盘根目录或 Windows 系统目录',
  },
  {
    pattern: /\b(?:rd|rmdir)\s+\/s\s+\/q\s+(?:[a-z]:\\(?:\s|$)|\\windows\\)/i,
    reason: '禁止递归删除磁盘根目录或 Windows 系统目录',
  },
  {
    pattern: /\breg(?:\.exe)?\s+delete\s+(?:hklm|hkey_local_machine)\\/i,
    reason: '禁止删除系统级注册表项',
  },
];

export function assessAgentCommand(command: string): {
  allowed: boolean;
  reason?: string;
} {
  if (!command.trim()) return { allowed: false, reason: '命令为空' };
  if (command.length > MAX_COMMAND_LENGTH) {
    return { allowed: false, reason: `命令长度超过限制（${MAX_COMMAND_LENGTH} 字符）` };
  }
  for (const rule of BLOCKED_COMMAND_PATTERNS) {
    if (rule.pattern.test(command)) return { allowed: false, reason: rule.reason };
  }
  return { allowed: true };
}

export function createAgentChildEnv(source: NodeJS.ProcessEnv = process.env): {
  env: NodeJS.ProcessEnv;
  redactedValues: string[];
} {
  const env: NodeJS.ProcessEnv = { NODE_ENV: source.NODE_ENV || 'development' };
  const redactedValues: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (value == null) continue;
    if (SECRET_NAME_PATTERN.test(name)) {
      if (value.length >= 6) redactedValues.push(value);
      continue;
    }
    env[name] = value;
  }
  env.HOME = env.HOME || env.USERPROFILE || '/root';
  return { env, redactedValues };
}

export function redactAgentOutput(text: string, redactedValues: string[]): string {
  let safe = text;
  for (const value of redactedValues) {
    if (value && safe.includes(value)) safe = safe.split(value).join('[REDACTED]');
  }
  return safe;
}
