import { NextResponse } from 'next/server';
import { getLocalSttDiagnostics, transcribeLocalStt } from '@/lib/local-stt.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getLocalSttDiagnostics());
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get('audio') as File | null;

    if (!audio) {
      return NextResponse.json({ error: '缺少音频文件' }, { status: 400 });
    }

    const buffer = await audio.arrayBuffer();
    if (buffer.byteLength < 44) {
      return NextResponse.json({ error: '音频文件过小' }, { status: 400 });
    }

    const result = await transcribeLocalStt(new Uint8Array(buffer));
    return NextResponse.json(result);
  } catch (error) {
    const diagnostics = getLocalSttDiagnostics(error);
    console.error('[local-stt] failed', JSON.stringify(diagnostics, null, 2));
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '本地 STT 识别失败',
        diagnostics,
      },
      { status: 500 }
    );
  }
}
