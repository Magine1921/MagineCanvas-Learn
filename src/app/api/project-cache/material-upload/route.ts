import { NextRequest, NextResponse } from 'next/server';
import { saveMaterialBufferToDiskCache } from '@/lib/project-material-disk-cache.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const nodeId = String(form.get('nodeId') || '').trim();
    const file = form.get('file');
    if (!nodeId || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'nodeId and image file are required' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: 'image file required' }, { status: 415 });
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: 'image file is empty or too large' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ok = await saveMaterialBufferToDiskCache(nodeId, buffer, file.type);
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'image cache write failed' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'image upload failed' },
      { status: 500 },
    );
  }
}
