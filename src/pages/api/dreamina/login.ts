// 即梦CLI - OAuth Device Flow 登录（官方流程）
import type { NextApiRequest, NextApiResponse } from 'next';
import { getCliPath } from '@/lib/dreamina-cli-exec';
import { ensureDreaminaCliMetadata, sanitizeDreaminaCliPath } from '@/lib/dreamina-cli-env.server';
import { openDreaminaExternalUrl, runDreaminaDeviceFlowLogin } from '@/lib/dreamina-cli-oauth.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res))) return;

  const body = (req.body || {}) as { cliPath?: unknown; forceRelogin?: unknown };
  const cliPath = sanitizeDreaminaCliPath(getCliPath(body));
  const forceRelogin = body.forceRelogin === true;

  try {
    const repair = await ensureDreaminaCliMetadata(cliPath);
    const result = await runDreaminaDeviceFlowLogin(cliPath, {
      openUrl: (url) => openDreaminaExternalUrl(url),
    }, { forceRelogin });

    return res.json({
      ...result,
      repairedMetadata: repair.repaired,
      repairErrors: repair.errors.length > 0 ? repair.errors : undefined,
      loginUrl: result.verificationUri,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'ENOENT') {
      return res.status(400).json({
        ok: false,
        error: `CLI 未找到: ${cliPath}，请先点击「自动安装」`,
      });
    }
    return res.status(500).json({
      ok: false,
      error: err.message || '无法完成 dreamina 登录',
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
