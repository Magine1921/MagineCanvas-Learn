import { NextRequest, NextResponse } from 'next/server';
import { isSameSiteUrlLoose } from '@/lib/topaz-same-site-url';
import { isHostLikelyUnreachableFromExternalService } from '@/lib/external-media-reachability';

export function getRequestPublicOrigin(req: NextRequest): string {
  const forwardedProto = req.headers.get('x-forwarded-proto');
  const forwardedHost = req.headers.get('x-forwarded-host');
  const host = (forwardedHost || req.headers.get('host') || '').trim();
  const fromUrl = new URL(req.url);
  if (!host) return fromUrl.origin;
  const proto = (forwardedProto || fromUrl.protocol.replace(':', '')).trim() || 'https';
  return `${proto}://${host}`;
}

export function isSameOriginAsRequest(req: NextRequest, rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const o = new URL(getRequestPublicOrigin(req));
    return isSameSiteUrlLoose(o, u);
  } catch {
    return false;
  }
}

export function resolveMediaUrlAgainstRequest(rawUrl: string, req: NextRequest): string {
  let s = rawUrl.trim();
  if (!s) return s;
  if (s.startsWith('//')) {
    try {
      const fromUrl = new URL(req.url);
      s = `${fromUrl.protocol}${s}`;
    } catch {
      /* keep */
    }
  } else if (s.startsWith('/') && !s.startsWith('//')) {
    try {
      s = new URL(s, getRequestPublicOrigin(req)).href;
    } catch {
      /* keep */
    }
  }
  return s;
}

export async function decodeDataUrlToBuffer(dataUrl: string): Promise<{ buf: Buffer; mime: string } | null> {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const b64 = m[2].replace(/\s/g, '');
  try {
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return null;
    return { buf, mime };
  } catch {
    return null;
  }
}

export function canAliyunFetchUrlDirectly(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return !isHostLikelyUnreachableFromExternalService(u.hostname);
  } catch {
    return false;
  }
}

export type AliyunBufferInput = { kind: 'buffer'; buffer: Buffer };
export type AliyunUrlInput = { kind: 'url'; url: string };

export async function loadImageForAliyun(
  body: { imageUrl?: unknown; imageBase64?: unknown },
  req: NextRequest
): Promise<AliyunUrlInput | AliyunBufferInput | NextResponse> {
  const rawUrlInput = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const rawUrl =
    rawUrlInput && !rawUrlInput.startsWith('data:') ? resolveMediaUrlAgainstRequest(rawUrlInput, req) : rawUrlInput;
  const rawB64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';

  if (rawUrl.startsWith('data:')) {
    const dec = await decodeDataUrlToBuffer(rawUrl);
    if (!dec) return NextResponse.json({ error: '无法解析 data URL 图片' }, { status: 400 });
    return { kind: 'buffer', buffer: dec.buf };
  }

  if (rawB64) {
    const b64 = rawB64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    try {
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return NextResponse.json({ error: 'imageBase64 为空' }, { status: 400 });
      return { kind: 'buffer', buffer: buf };
    } catch {
      return NextResponse.json({ error: 'imageBase64 无效' }, { status: 400 });
    }
  }

  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('asset:')) {
    return NextResponse.json(
      { error: '不支持 blob:/asset: 直链，请使用公网 http(s) 图片地址或 data URL / imageBase64' },
      { status: 400 }
    );
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    if (canAliyunFetchUrlDirectly(rawUrl)) {
      return { kind: 'url', url: rawUrl };
    }
    if (isSameOriginAsRequest(req, rawUrl)) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 120_000);
      try {
        const r = await fetch(rawUrl, { signal: ctrl.signal, redirect: 'error' });
        if (!r.ok) {
          return NextResponse.json({ error: `拉取图片失败 HTTP ${r.status}` }, { status: 400 });
        }
        const ab = await r.arrayBuffer();
        const buf = Buffer.from(ab);
        if (!buf.length) return NextResponse.json({ error: '图片内容为空' }, { status: 400 });
        return { kind: 'buffer', buffer: buf };
      } catch {
        return NextResponse.json({ error: '拉取同源图片超时或失败' }, { status: 400 });
      } finally {
        clearTimeout(t);
      }
    }
    return NextResponse.json(
      {
        error:
          '该图片 URL 的主机无法被阿里云公网拉取（如内网或未部署域名）。请上传到公网可访问地址，或使用 data URL / 由本站同源代拉取。',
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: '请提供 imageUrl（http(s)、data URL）或 imageBase64' }, { status: 400 });
}

export async function loadVideoForAliyun(
  body: { videoUrl?: unknown; videoBase64?: unknown },
  req: NextRequest
): Promise<AliyunUrlInput | AliyunBufferInput | NextResponse> {
  const rawUrlInput = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
  const rawUrl =
    rawUrlInput && !rawUrlInput.startsWith('data:') ? resolveMediaUrlAgainstRequest(rawUrlInput, req) : rawUrlInput;
  const rawB64 = typeof body.videoBase64 === 'string' ? body.videoBase64.trim() : '';

  if (rawUrl.startsWith('data:')) {
    const dec = await decodeDataUrlToBuffer(rawUrl);
    if (!dec) return NextResponse.json({ error: '无法解析 data URL 视频' }, { status: 400 });
    return { kind: 'buffer', buffer: dec.buf };
  }

  if (rawB64) {
    const b64 = rawB64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    try {
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return NextResponse.json({ error: 'videoBase64 为空' }, { status: 400 });
      return { kind: 'buffer', buffer: buf };
    } catch {
      return NextResponse.json({ error: 'videoBase64 无效' }, { status: 400 });
    }
  }

  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('asset:')) {
    return NextResponse.json(
      { error: '不支持 blob:/asset: 直链，请使用公网 http(s) 视频地址或 data URL / videoBase64' },
      { status: 400 }
    );
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    if (canAliyunFetchUrlDirectly(rawUrl)) {
      return { kind: 'url', url: rawUrl };
    }
    if (isSameOriginAsRequest(req, rawUrl)) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 600_000);
      try {
        const r = await fetch(rawUrl, { signal: ctrl.signal, redirect: 'error' });
        if (!r.ok) {
          return NextResponse.json({ error: `拉取视频失败 HTTP ${r.status}` }, { status: 400 });
        }
        const ab = await r.arrayBuffer();
        const buf = Buffer.from(ab);
        if (!buf.length) return NextResponse.json({ error: '视频内容为空' }, { status: 400 });
        return { kind: 'buffer', buffer: buf };
      } catch {
        return NextResponse.json({ error: '拉取同源视频超时或失败' }, { status: 400 });
      } finally {
        clearTimeout(t);
      }
    }
    return NextResponse.json(
      {
        error:
          '该视频 URL 的主机无法被阿里云公网拉取（如内网或未部署域名）。请上传到公网可访问地址，或使用 data URL / 由本站同源代拉取。',
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: '请提供 videoUrl（http(s)、data URL）或 videoBase64' }, { status: 400 });
}

export function resolveAliyunCredentials(body: Record<string, unknown>): { ak: string; sk: string } | NextResponse {
  const ak =
    (typeof body.accessKeyId === 'string' && body.accessKeyId.trim()) ||
    process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ||
    '';
  const sk =
    (typeof body.accessKeySecret === 'string' && body.accessKeySecret.trim()) ||
    process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ||
    '';
  if (!ak || !sk) {
    return NextResponse.json(
      {
        error:
          '未配置阿里云凭证：请在「API 配置 → 画质提升」填写 RAM 用户的 AccessKey，或在服务器设置环境变量 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET',
      },
      { status: 400 }
    );
  }
  return { ak, sk };
}
