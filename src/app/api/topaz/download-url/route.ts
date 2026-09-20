import { NextRequest, NextResponse } from 'next/server';
import { getKieDownloadUrl } from '@/lib/kie-topaz.server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be JSON' }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Missing Topaz/Kie API Key' }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ ok: false, error: 'Missing file URL' }, { status: 400 });
  }

  try {
    const downloadUrl = await getKieDownloadUrl({ apiKey, apiUrl, url });
    return NextResponse.json({ ok: true, downloadUrl });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Topaz download-url failed' },
      { status: 502 },
    );
  }
}
