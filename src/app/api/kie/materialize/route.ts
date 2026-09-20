import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 180;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be JSON' }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const kind = body.kind === 'video' ? 'video' : 'image';
  const rawInputs = Array.isArray(body.inputs)
    ? body.inputs
    : typeof body.inputUrl === 'string'
      ? [body.inputUrl]
      : [];
  const inputs = [...new Set(rawInputs.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))]
    .slice(0, 16);

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Missing Kie API Key' }, { status: 400 });
  }
  if (inputs.length === 0) {
    return NextResponse.json({ ok: false, error: 'Missing Kie reference input' }, { status: 400 });
  }

  try {
    const { materializeKieInput } = await import('@/lib/kie-topaz.server');
    const results = [];
    for (const inputUrl of inputs) {
      const materialized = await materializeKieInput({
        apiKey,
        inputUrl,
        kind,
        requestUrl: req.url,
      });
      results.push({
        source: inputUrl.startsWith('data:') ? 'data' : inputUrl,
        url: materialized.url,
        alternateUrls: materialized.alternateUrls,
        width: materialized.width,
        height: materialized.height,
        byteLength: materialized.byteLength,
        contentType: materialized.contentType,
      });
    }

    return NextResponse.json({
      ok: true,
      urls: results.map((item) => item.url).filter(Boolean),
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, 'Kie reference materialize failed') },
      { status: 502 },
    );
  }
}
