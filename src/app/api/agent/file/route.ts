import { NextResponse } from 'next/server';
import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname, relative, join, isAbsolute } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  assessAgentCommand,
  createAgentChildEnv,
  redactAgentOutput,
} from '@/lib/agent-execution-policy.server';
import { buildAgentShellArgs, resolveAgentShell } from '@/lib/agent-shell.server';
import { authorizeAgentLocalApiRequest } from '@/lib/agent-local-api-auth.server';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(
  process.env.MAGINECANVAS_PROJECT_ROOT ||
    process.env.INIT_CWD ||
    /*turbopackIgnore: true*/ process.cwd()
);
class AgentPathError extends Error {}

function safePath(inputPath: string): string {
  const resolved = resolve(/*turbopackIgnore: true*/ PROJECT_ROOT, inputPath);
  const rel = relative(/*turbopackIgnore: true*/ PROJECT_ROOT, resolved);
  if (rel && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new AgentPathError('路径超出项目根目录范围');
  }
  return resolved;
}

function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (pattern[i] === '/') { re += '/'; i++; }
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i++;
    } else if (ch === '.') {
      re += '\\.';
      i++;
    } else if ('\\^$+{}()|[]'.includes(ch)) {
      re += '\\' + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

async function walkDir(dir: string, regex: RegExp, base: string, results: string[], max: number): Promise<void> {
  if (results.length >= max) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (results.length >= max) return;
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = join(dir, ent.name);
    const rel = relative(base, full).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      await walkDir(full, regex, base, results, max);
    } else if (regex.test(rel)) {
      results.push(rel);
    }
  }
}

async function globSearch(baseDir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  const regex = globToRegex(pattern);
  await walkDir(baseDir, regex, baseDir, results, 500);
  return results;
}

function relativeProjectPath(filePath: string): string {
  const rel = relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') ? rel : filePath.replace(/\\/g, '/');
}

function parseRgJson(stdout: string): Array<{ file: string; line: number; content: string }> {
  const matches: Array<{ file: string; line: number; content: string }> = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          lines?: { text?: string };
        };
      };
      if (event.type !== 'match') continue;
      const file = event.data?.path?.text || '';
      const lineNumber = event.data?.line_number || 0;
      const content = (event.data?.lines?.text || '').replace(/\r?\n$/, '');
      matches.push({ file: relativeProjectPath(file), line: lineNumber, content });
    } catch {
      // Ignore malformed rg JSON lines instead of failing the whole search.
    }
  }
  return matches;
}

export async function POST(req: Request) {
  try {
    const authorization = authorizeAgentLocalApiRequest(req);
    if (!authorization.ok) {
      return NextResponse.json(
        { success: false, error: authorization.error },
        { status: authorization.status }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = (body.action as string) || '';

    switch (action) {
      case 'read_file': {
        const filePath = String(body.file_path || '');
        if (!filePath) return NextResponse.json({ success: false, error: '缺少 file_path' });
        const abs = safePath(filePath);
        if (!existsSync(abs)) return NextResponse.json({ success: false, error: '文件不存在' });
        const content = await readFile(abs, 'utf-8');
        let lines = content.split('\n');
        const offset = typeof body.offset === 'number' ? body.offset : 0;
        const limit = typeof body.limit === 'number' ? body.limit : lines.length;
        if (offset > 0 || limit < lines.length) {
          lines = lines.slice(offset, offset + limit);
        }
        return NextResponse.json({ success: true, content: lines.join('\n') });
      }

      case 'write_file': {
        const filePath = String(body.file_path || '');
        const content = String(body.content || '');
        if (!filePath) return NextResponse.json({ success: false, error: '缺少 file_path' });
        const abs = safePath(filePath);
        const dir = dirname(abs);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        await writeFile(abs, content, 'utf-8');
        return NextResponse.json({ success: true, message: `文件 ${filePath} 已写入` });
      }

      case 'edit_file': {
        const filePath = String(body.file_path || '');
        const oldStr = String(body.old_string || '');
        const newStr = String(body.new_string || '');
        if (!filePath || !oldStr) return NextResponse.json({ success: false, error: '缺少参数' });
        const abs = safePath(filePath);
        if (!existsSync(abs)) return NextResponse.json({ success: false, error: '文件不存在' });
        const content = await readFile(abs, 'utf-8');
        if (!content.includes(oldStr)) return NextResponse.json({ success: false, error: '未找到要替换的内容' });
        await writeFile(abs, content.replace(oldStr, newStr), 'utf-8');
        return NextResponse.json({ success: true, message: `文件 ${filePath} 已编辑` });
      }

      case 'glob_search': {
        const pattern = String(body.pattern || '');
        if (!pattern) return NextResponse.json({ success: false, error: '缺少 pattern' });
        const searchPath = typeof body.path === 'string' ? safePath(body.path) : PROJECT_ROOT;
        const files = await globSearch(searchPath, pattern);
        return NextResponse.json({ success: true, files: files.slice(0, 200) });
      }

      case 'grep_search': {
        const pattern = String(body.pattern || '');
        if (!pattern) return NextResponse.json({ success: false, error: '缺少 pattern' });
        const searchPath = typeof body.path === 'string' ? body.path : '.';
        const include = typeof body.include === 'string' ? body.include : undefined;
        const absSearchPath = safePath(searchPath);
        const args = ['--json', '--line-number'];
        if (include) args.push('--glob', include);
        args.push(pattern, absSearchPath);
        try {
          const { stdout } = await execFileAsync('rg', args, {
            cwd: PROJECT_ROOT,
            timeout: 15000,
            maxBuffer: 1024 * 1024,
          });
          const matches = parseRgJson(stdout).slice(0, 200);
          return NextResponse.json({ success: true, matches });
        } catch (e: unknown) {
          const err = e as { code?: number; stderr?: string; stdout?: string; message?: string };
          if (err.code === 1) {
            return NextResponse.json({ success: true, matches: parseRgJson(err.stdout || '').slice(0, 200) });
          }
          if (err.stderr?.includes('No such file')) {
            return NextResponse.json({ success: true, matches: [] });
          }
          return NextResponse.json({ success: false, error: err.stderr || err.message || String(e) });
        }
      }

      case 'bash': {
        const command = String(body.command || '');
        if (!command) return NextResponse.json({ success: false, error: '缺少 command' });
        const cwd = typeof body.cwd === 'string' ? safePath(body.cwd) : PROJECT_ROOT;
        const policy = assessAgentCommand(command);
        if (!policy.allowed) {
          return NextResponse.json({
            success: false,
            error: `命令已被安全策略阻止：${policy.reason}`,
          });
        }
        const childEnvironment = createAgentChildEnv();
        const shell = resolveAgentShell();

        try {
          const { stdout, stderr } = await execFileAsync(
            shell.executable,
            buildAgentShellArgs(command, shell),
            {
              cwd,
              timeout: 60000,
              maxBuffer: 10 * 1024 * 1024,
              env: childEnvironment.env,
            },
          );
          return NextResponse.json({
            success: true,
            stdout: redactAgentOutput(stdout, childEnvironment.redactedValues),
            stderr: redactAgentOutput(stderr, childEnvironment.redactedValues),
          });
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; message?: string };
          return NextResponse.json({
            success: false,
            stdout: redactAgentOutput(err.stdout || '', childEnvironment.redactedValues),
            stderr: redactAgentOutput(err.stderr || '', childEnvironment.redactedValues),
            message: err.message || String(e),
          });
        }
      }

      default:
        return NextResponse.json({ success: false, error: `未知操作: ${action}` });
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : '服务器内部错误' },
      { status: e instanceof AgentPathError ? 400 : 500 }
    );
  }
}
