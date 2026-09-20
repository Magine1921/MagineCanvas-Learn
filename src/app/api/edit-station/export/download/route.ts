import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getMagineCacheRoot } from '@/lib/magine-cache-root.server';

export const dynamic = 'force-dynamic';

function safeDownloadName(value: string): string {
  return value
    .replace(/[\r\n"]/g, '_')
    .replace(/[\\/:*?<>|]+/g, '_')
    .slice(0, 160) || 'maginecanvas_project.zip';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId')?.trim() || '';
  if (!/^export_\d+_[a-z0-9]+$/i.test(jobId)) {
    return NextResponse.json({ error: '无效的导出任务' }, { status: 400 });
  }

  const filePath = path.join(getMagineCacheRoot(), 'edit-exports', `${jobId}.zip`);
  try {
    const buffer = await fs.readFile(filePath);
    await fs.unlink(filePath).catch(() => {});
    const fileName = safeDownloadName(searchParams.get('fileName') || '');
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: '导出文件不存在或已经下载' }, { status: 404 });
  }
}
