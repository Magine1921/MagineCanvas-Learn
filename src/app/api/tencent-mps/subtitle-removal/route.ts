import { NextRequest, NextResponse } from 'next/server';
import COS from 'cos-nodejs-sdk-v5';
import { mps } from 'tencentcloud-sdk-nodejs-mps';
import {
  missingTencentMpsSubtitleRemovalFields,
  normalizeTencentMpsSubtitleRemovalConfig,
  type TencentMpsSubtitleRemovalConfig,
} from '@/lib/tencent-mps-subtitle-removal';
import {
  normalizeSubtitleRemovalRegion,
  subtitleRemovalRegionToTencentArea,
  type SubtitleRemovalMode,
  type SubtitleRemovalRegion,
} from '@/lib/subtitle-removal-region';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MpsClient = mps.v20190612.Client;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;

type MediaType = 'image' | 'video';

function readRemovalOptions(form: FormData): {
  mode: SubtitleRemovalMode;
  region: SubtitleRemovalRegion | null;
} {
  const mode: SubtitleRemovalMode = form.get('mode') === 'custom' ? 'custom' : 'auto';
  let rawRegion: unknown = null;
  try {
    rawRegion = JSON.parse(String(form.get('region') || 'null'));
  } catch {
    throw new Error('指定区域擦除参数格式错误');
  }
  const region = normalizeSubtitleRemovalRegion(rawRegion);
  if (mode === 'custom' && !region) throw new Error('指定区域擦除缺少有效框选区域');
  return { mode, region };
}

function jsonError(error: unknown, status = 500) {
  const source = error as { code?: unknown; message?: unknown; requestId?: unknown } | null;
  const code = String(source?.code || '').trim();
  const message = String(source?.message || error || '腾讯云 MPS 请求失败').trim();
  const requestId = String(source?.requestId || '').trim();
  return NextResponse.json(
    {
      ok: false,
      error: [code, message, requestId ? `RequestId: ${requestId}` : ''].filter(Boolean).join(' · '),
    },
    { status },
  );
}

function readConfig(value: unknown): TencentMpsSubtitleRemovalConfig {
  const config = normalizeTencentMpsSubtitleRemovalConfig(
    value && typeof value === 'object'
      ? value as Partial<TencentMpsSubtitleRemovalConfig>
      : undefined,
  );
  const missing = missingTencentMpsSubtitleRemovalFields(config);
  if (missing.length > 0) throw new Error(`请先配置：${missing.join('、')}`);
  if (!/^[a-z0-9][a-z0-9.-]*-\d+$/i.test(config.cosBucket)) {
    throw new Error('COS Bucket 必须填写完整名称，例如 examplebucket-1250000000');
  }
  return config;
}

function createMpsClient(config: TencentMpsSubtitleRemovalConfig) {
  return new MpsClient({
    credential: { secretId: config.secretId, secretKey: config.secretKey },
    region: config.mpsRegion,
    profile: {
      httpProfile: { endpoint: 'mps.tencentcloudapi.com', reqTimeout: 120 },
    },
  });
}

function createCosClient(config: TencentMpsSubtitleRemovalConfig) {
  return new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
}

async function resolveVideoTemplateId(
  client: InstanceType<typeof MpsClient>,
  configuredId: number | null,
) {
  const response = await client.DescribeSmartEraseTemplates({
    ...(configuredId ? { Definitions: [configuredId] } : {}),
    EraseType: 'subtitle',
    Offset: 0,
    Limit: 100,
  });
  const templates = response.SmartEraseTemplateSet || [];
  const selected = configuredId
    ? templates.find((item) => Number(item.Definition) === configuredId)
    : templates.find((item) => item.Type === 'Custom') || templates[0];
  if (!selected?.Definition) {
    throw new Error(
      configuredId
        ? `未找到视频去字幕模板 ${configuredId}，请检查模板 ID 和 MPS 地域`
        : '未找到视频去字幕模板，请先在腾讯云 MPS 创建“智能擦除 / 去字幕”模板',
    );
  }
  return {
    definition: Number(selected.Definition),
    name: selected.Name || selected.AliasName || `模板 ${selected.Definition}`,
  };
}

function safeFileName(value: string, mediaType: MediaType) {
  const fallback = mediaType === 'video' ? 'video.mp4' : 'image.png';
  const normalized = String(value || fallback).split(/[\\/]/).pop() || fallback;
  return normalized.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_').slice(-120) || fallback;
}

function fileExtension(fileName: string, mime: string, mediaType: MediaType) {
  const matched = /\.([a-zA-Z0-9]{2,8})$/.exec(fileName);
  if (matched) return `.${matched[1].toLowerCase()}`;
  if (mediaType === 'video') return mime.includes('webm') ? '.webm' : mime.includes('quicktime') ? '.mov' : '.mp4';
  return mime.includes('jpeg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png';
}

function safeStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_').slice(0, 72) || 'media';
}

async function readSourceMedia(request: NextRequest, form: FormData, mediaType: MediaType) {
  const uploaded = form.get('file');
  const requestedName = String(form.get('fileName') || '').trim();
  if (uploaded instanceof File) {
    if (uploaded.size <= 0 || uploaded.size > MAX_SOURCE_BYTES) throw new Error('素材为空或超过 512MB');
    const bytes = Buffer.from(await uploaded.arrayBuffer());
    return {
      bytes,
      mime: uploaded.type || (mediaType === 'video' ? 'video/mp4' : 'image/png'),
      fileName: safeFileName(requestedName || uploaded.name, mediaType),
    };
  }

  const sourceUrl = String(form.get('sourceUrl') || '').trim();
  if (!sourceUrl) throw new Error('缺少待处理素材');
  const resolved = new URL(sourceUrl, request.url);
  const requestOrigin = new URL(request.url).origin;
  const isSameOrigin = resolved.origin === requestOrigin;
  if (resolved.protocol !== 'https:' && !isSameOrigin) {
    throw new Error('素材地址不可读取，请重新上传素材后再试');
  }
  const requestInit = {
    cache: 'no-store' as const,
    headers: { Accept: mediaType === 'video' ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8' },
  };
  let response: Response;
  if (isSameOrigin) {
    if (resolved.pathname !== '/api/project-cache/material' && resolved.pathname !== '/api/project-cache/panorama') {
      throw new Error('素材地址不是允许的本地素材接口');
    }
    response = await fetch(resolved, { ...requestInit, redirect: 'error' });
  } else {
    response = await fetchSafeOutboundUrl(resolved, requestInit, { allowedProtocols: ['https:'] });
  }
  if (!response.ok) throw new Error(`素材读取失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_SOURCE_BYTES) throw new Error('素材超过 512MB');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > MAX_SOURCE_BYTES) throw new Error('素材为空或超过 512MB');
  const mime = response.headers.get('content-type')?.split(';', 1)[0] || '';
  return {
    bytes,
    mime: mime || (mediaType === 'video' ? 'video/mp4' : 'image/png'),
    fileName: safeFileName(requestedName || decodeURIComponent(resolved.pathname.split('/').pop() || ''), mediaType),
  };
}

function outputStorage(config: TencentMpsSubtitleRemovalConfig) {
  return {
    Type: 'COS',
    CosOutputStorage: { Bucket: config.cosBucket, Region: config.cosRegion },
  };
}

function cosInput(config: TencentMpsSubtitleRemovalConfig, key: string) {
  return {
    Type: 'COS',
    CosInputInfo: { Bucket: config.cosBucket, Region: config.cosRegion, Object: `/${key}` },
  };
}

function signedCosUrl(config: TencentMpsSubtitleRemovalConfig, key: string) {
  return createCosClient(config).getObjectUrl({
    Bucket: config.cosBucket,
    Region: config.cosRegion,
    Key: key.replace(/^\/+/, ''),
    Sign: true,
    Protocol: 'https:',
    Expires: 6 * 60 * 60,
  });
}

async function cleanupInput(config: TencentMpsSubtitleRemovalConfig, inputKey: string) {
  if (!inputKey) return;
  try {
    await createCosClient(config).deleteObject({
      Bucket: config.cosBucket,
      Region: config.cosRegion,
      Key: inputKey.replace(/^\/+/, ''),
    });
  } catch {
    // Input objects are temporary; cleanup failure must not hide the processing result.
  }
}

async function handleTest(config: TencentMpsSubtitleRemovalConfig) {
  const cos = createCosClient(config);
  await cos.headBucket({ Bucket: config.cosBucket, Region: config.cosRegion });
  const mpsClient = createMpsClient(config);
  const template = await resolveVideoTemplateId(mpsClient, config.videoTemplateId);
  return NextResponse.json({
    ok: true,
    message: `连接成功，COS 可用；视频去字幕将使用“${template.name}”（${template.definition}）`,
    videoTemplateId: template.definition,
  });
}

async function handleSubmit(request: NextRequest, form: FormData) {
  const mediaType = form.get('mediaType') === 'video' ? 'video' : form.get('mediaType') === 'image' ? 'image' : null;
  if (!mediaType) throw new Error('不支持的素材类型');
  const removal = readRemovalOptions(form);
  const config = readConfig(JSON.parse(String(form.get('config') || '{}')));
  const source = await readSourceMedia(request, form, mediaType);
  const now = Date.now();
  const nonce = Math.random().toString(36).slice(2, 10);
  const extension = fileExtension(source.fileName, source.mime, mediaType);
  const stem = safeStem(source.fileName);
  const prefix = config.cosPrefix || 'maginecanvas/subtitle-removal';
  const inputKey = `${prefix}/input/${now}-${nonce}-${stem}${extension}`;
  const outputDir = `/${prefix}/output/`;
  const outputName = `${now}-${nonce}-${stem}-subtitle-removed`;

  const cos = createCosClient(config);
  await cos.putObject({
    Bucket: config.cosBucket,
    Region: config.cosRegion,
    Key: inputKey,
    Body: source.bytes,
    ContentType: source.mime,
  });

  try {
    const client = createMpsClient(config);
    if (mediaType === 'video') {
      const template = await resolveVideoTemplateId(client, config.videoTemplateId);
      const area = removal.region ? subtitleRemovalRegionToTencentArea(removal.region) : null;
      const response = await client.ProcessMedia({
        InputInfo: cosInput(config, inputKey),
        OutputStorage: outputStorage(config),
        OutputDir: outputDir,
        SmartEraseTask: {
          Definition: template.definition,
          ...(removal.mode === 'custom' && area ? {
            OverrideParameter: {
              EraseType: 'subtitle',
              EraseSubtitleConfig: {
                SubtitleEraseMethod: 'custom',
                SubtitleModel: 'standard',
                OcrSwitch: 'OFF',
                CustomAreas: [{ BeginMs: 0, EndMs: 0, Areas: [area] }],
              },
            },
          } : {}),
          OutputObjectPath: `/${prefix}/output/${outputName}.{format}`,
        },
        SessionContext: `MagineCanvas subtitle removal ${now}`,
      });
      if (!response.TaskId) throw new Error('腾讯云未返回视频任务 ID');
      return NextResponse.json({
        ok: true,
        taskId: response.TaskId,
        mediaType,
        inputKey,
        fileName: `${outputName}.mp4`,
        videoTemplateId: template.definition,
      });
    }

    const imageArea = removal.region ? subtitleRemovalRegionToTencentArea(removal.region) : null;
    const response = await client.ProcessImage({
      InputInfo: cosInput(config, inputKey),
      OutputStorage: outputStorage(config),
      OutputDir: outputDir,
      OutputPath: `/${prefix}/output/${outputName}.{format}`,
      ...(removal.mode === 'custom' && imageArea ? {
        ImageTask: {
          EraseConfig: {
            ImageEraseLogo: {
              Switch: 'ON',
              ImageAreaBoxes: [{
                Type: 'text',
                BoundingBox: [
                  imageArea.LeftTopX,
                  imageArea.LeftTopY,
                  imageArea.RightBottomX,
                  imageArea.RightBottomY,
                ],
                BoundingBoxUnitType: 1,
              }],
              DetectTypes: ['text'],
            },
          },
        },
      } : { ScheduleId: 30000 }),
    });
    if (!response.TaskId) throw new Error('腾讯云未返回图片任务 ID');
    return NextResponse.json({
      ok: true,
      taskId: response.TaskId,
      mediaType,
      inputKey,
      fileName: `${outputName}${extension}`,
    });
  } catch (error) {
    await cleanupInput(config, inputKey);
    throw error;
  }
}

async function handleQuery(body: Record<string, unknown>) {
  const config = readConfig(body.config);
  const taskId = String(body.taskId || '').trim();
  const mediaType: MediaType | null = body.mediaType === 'video' ? 'video' : body.mediaType === 'image' ? 'image' : null;
  const inputKey = String(body.inputKey || '').trim();
  if (!taskId || !mediaType) throw new Error('去字幕任务参数不完整');
  const client = createMpsClient(config);

  if (mediaType === 'image') {
    const response = await client.DescribeImageTaskDetail({ TaskId: taskId });
    const result = response.ImageProcessTaskResultSet?.[0];
    const progress = Math.max(0, Math.min(100, Number(result?.Progress || 0)));
    if (result?.Status === 'FAIL' || (response.Status === 'FINISH' && !result?.Output)) {
      await cleanupInput(config, inputKey);
      throw new Error(result?.Message || result?.ErrMsg || response.Message || response.ErrMsg || '图片去字幕失败');
    }
    if (result?.Status === 'SUCCESS' && result.Output) {
      const outputPath = String(result.Output.Path || '').trim();
      const url = String(result.Output.SignedUrl || '').trim() || (outputPath ? signedCosUrl(config, outputPath) : '');
      if (!url) throw new Error('腾讯云任务成功，但没有返回图片结果地址');
      await cleanupInput(config, inputKey);
      return NextResponse.json({ ok: true, status: 'complete', progress: 100, url, outputPath });
    }
    return NextResponse.json({ ok: true, status: 'processing', progress });
  }

  const response = await client.DescribeTaskDetail({ TaskId: taskId });
  const result = response.WorkflowTask?.SmartEraseTaskResult;
  const progress = Math.max(0, Math.min(100, Number(result?.Progress || 0)));
  if (result?.Status === 'FAIL' || (response.Status === 'FINISH' && result?.Status !== 'SUCCESS')) {
    await cleanupInput(config, inputKey);
    throw new Error(result?.Message || response.WorkflowTask?.Message || '视频去字幕失败');
  }
  if (result?.Status === 'SUCCESS' && result.Output) {
    const outputPath = String(result.Output.ErasedVideoPath || result.Output.Path || '').trim();
    if (!outputPath) throw new Error('腾讯云任务成功，但没有返回视频结果地址');
    const url = /^https?:\/\//i.test(outputPath) ? outputPath : signedCosUrl(config, outputPath);
    await cleanupInput(config, inputKey);
    return NextResponse.json({ ok: true, status: 'complete', progress: 100, url, outputPath });
  }
  return NextResponse.json({ ok: true, status: 'processing', progress });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      if (String(form.get('action') || '') !== 'submit') throw new Error('不支持的去字幕操作');
      return await handleSubmit(request, form);
    }

    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || '');
    if (action === 'test') return await handleTest(readConfig(body.config));
    if (action === 'query') return await handleQuery(body);
    throw new Error('不支持的去字幕操作');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    const status = /请先配置|必须填写|缺少|不支持|参数|素材为空|超过 512MB/.test(message) ? 400 : 502;
    return jsonError(error, status);
  }
}
