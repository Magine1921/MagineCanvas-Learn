import { spawn } from 'child_process';
import { isAbsolute, relative, resolve } from 'path';
import {
  assessAgentCommand,
  createAgentChildEnv,
  redactAgentOutput,
} from '@/lib/agent-execution-policy.server';
import { buildAgentShellArgs, resolveAgentShell } from '@/lib/agent-shell.server';
import { authorizeAgentLocalApiRequest } from '@/lib/agent-local-api-auth.server';

export const runtime = 'nodejs';

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

export async function POST(req: Request) {
  const authorization = authorizeAgentLocalApiRequest(req);
  if (!authorization.ok) {
    return new Response(`event: error\ndata: ${authorization.error}\n\n`, {
      status: authorization.status,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const body = (await req.json().catch(() => ({}))) as { command?: string; cwd?: string };
  const command = body.command || '';
  if (!command) {
    return new Response('event: error\ndata: 缺少 command 参数\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  const policy = assessAgentCommand(command);
  if (!policy.allowed) {
    return new Response(`event: error\ndata: 命令已被安全策略阻止：${policy.reason}\n\n`, {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  let cwd = PROJECT_ROOT;
  try {
    if (body.cwd) cwd = safePath(body.cwd);
  } catch (error) {
    const message = error instanceof AgentPathError ? error.message : '工作目录无效';
    return new Response(`event: error\ndata: ${message}\n\n`, {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  const shell = resolveAgentShell();
  const childEnvironment = createAgentChildEnv();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let settled = false;
      let outputBytes = 0;
      const maxOutputBytes = 10 * 1024 * 1024;
      const child = spawn(shell.executable, buildAgentShellArgs(command, shell), {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnvironment.env,
      });

      const stop = (message: string) => {
        if (settled) return;
        settled = true;
        if (!child.killed) child.kill();
        controller.enqueue(encoder.encode(`event: error\ndata: ${message}\n\n`));
        controller.close();
      };

      const enqueueOutput = (event: 'stdout' | 'stderr', chunk: Buffer) => {
        if (settled) return;
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          stop('命令输出超过 10MB，任务已终止');
          return;
        }
        const text = redactAgentOutput(chunk.toString(), childEnvironment.redactedValues);
        const lines = text.split('\n');
        const sseBody = lines.map((line) => `data: ${line}`).join('\n');
        controller.enqueue(encoder.encode(`event: ${event}\n${sseBody}\n\n`));
      };

      child.stdout.on('data', (chunk: Buffer) => {
        enqueueOutput('stdout', chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        enqueueOutput('stderr', chunk);
      });

      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        controller.enqueue(encoder.encode(`event: close\ndata: ${code ?? -1}\n\n`));
        controller.close();
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        stop(err.message);
      });

      const timeout = setTimeout(() => stop('命令执行超时（5分钟）'), 300000);
      req.signal.addEventListener('abort', () => stop('客户端已取消命令'), { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
