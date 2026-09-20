// 即梦CLI - 查询用户余额/登录状态（自动修复 version.json）
import type { NextApiRequest, NextApiResponse } from 'next';
import { execDreaminaCli, getCliPath } from '@/lib/dreamina-cli-exec';
import { ensureDreaminaCliMetadata, parseUserCreditOutput, sanitizeDreaminaCliPath } from '@/lib/dreamina-cli-env.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (req.method === 'POST' && !(await preparePagesApiJsonBody(req, res))) return;

  const rawPath =
    req.method === 'POST'
      ? getCliPath((req.body || {}) as { cliPath?: unknown })
      : typeof req.query.cliPath === 'string'
        ? req.query.cliPath
        : 'dreamina';
  const cliPath = sanitizeDreaminaCliPath(rawPath);

  let repairNote = '';
  try {
    const repair = await ensureDreaminaCliMetadata(cliPath);
    if (repair.repaired) {
      repairNote = '已自动补全 CLI 版本文件';
    } else if (repair.errors.length > 0 && !repair.versionJson) {
      repairNote = `版本文件补全失败: ${repair.errors[0]}`;
    }
  } catch (e) {
    repairNote = `元数据修复异常: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const { stdout, stderr, usedPath } = await execDreaminaCli(cliPath, ['user_credit'], {
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = parseUserCreditOutput(stdout, stderr);
    if (parsed.ok) {
      return res.json({
        ok: true,
        loggedIn: true,
        loginName: parsed.loginName,
        data: parsed.data,
        usedPath,
        ...(repairNote ? { note: repairNote } : {}),
      });
    }

    return res.json({
      ok: false,
      loggedIn: false,
      error: parsed.error,
      needsLogin: parsed.needsLogin,
      needsRepair: parsed.needsRepair,
      ...(repairNote ? { note: repairNote } : {}),
    });
  } catch (e) {
    const err = e as { code?: string; stderr?: string; stdout?: string; killed?: boolean; message?: string };

    if (err.code === 'ENOENT') {
      if (cliPath !== 'dreamina') {
        try {
          const { stdout, stderr, usedPath } = await execDreaminaCli('dreamina', ['user_credit'], {
            timeout: 20000,
            maxBuffer: 1024 * 1024,
          });
          const parsed = parseUserCreditOutput(stdout, stderr);
          if (parsed.ok) {
            return res.json({
              ok: true,
              loggedIn: true,
              loginName: parsed.loginName,
              data: parsed.data,
              usedPath,
              note: `CLI 通过 PATH 找到（指定路径 ${cliPath} 无效，已回退至 dreamina）${repairNote ? `；${repairNote}` : ''}`,
            });
          }
        } catch {
          /* both failed */
        }
      }
      return res.json({
        ok: false,
        loggedIn: false,
        error: `CLI 未找到: ${cliPath}，请先点击「自动安装」`,
        needsLogin: false,
        needsRepair: false,
      });
    }

    if (err.killed) {
      return res.json({ ok: false, loggedIn: false, error: '命令执行超时' });
    }

    const parsed = parseUserCreditOutput(err.stdout || '', err.stderr || err.message || '');
    if (parsed.ok) {
      return res.json({
        ok: true,
        loggedIn: true,
        loginName: parsed.loginName,
        data: parsed.data,
        ...(repairNote ? { note: repairNote } : {}),
      });
    }

    return res.json({
      ok: false,
      loggedIn: false,
      error: parsed.error,
      needsLogin: parsed.needsLogin,
      needsRepair: parsed.needsRepair,
      ...(repairNote ? { note: repairNote } : {}),
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
