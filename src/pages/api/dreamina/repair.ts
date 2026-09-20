// 即梦CLI - 修复 version.json / SKILL.md
import type { NextApiRequest, NextApiResponse } from 'next';
import { getCliPath } from '@/lib/dreamina-cli-exec';
import { ensureDreaminaCliMetadata, sanitizeDreaminaCliPath } from '@/lib/dreamina-cli-env.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res))) return;

  const cliPath = sanitizeDreaminaCliPath(getCliPath((req.body || {}) as { cliPath?: unknown }));

  try {
    const result = await ensureDreaminaCliMetadata(cliPath);
    if (result.versionJson) {
      return res.json({
        ok: true,
        repaired: result.repaired,
        versionJson: result.versionJson,
        skillMd: result.skillMd,
        errors: result.errors,
        message: result.repaired ? '已补全 CLI 版本与技能文件' : 'CLI 元数据已是最新',
      });
    }
    return res.status(500).json({
      ok: false,
      repaired: false,
      errors: result.errors,
      error: result.errors[0] || '修复失败',
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : '修复失败',
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
