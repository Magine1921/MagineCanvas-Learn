const DAILY_GENERATION_LIMIT = 100;
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__');

export type TrialGenerationLimitResult = {
  enabled: boolean;
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  retryAfterSeconds: number;
};

function isWebTrialBuild(): boolean {
  return process.env.NEXT_PUBLIC_MAGINE_WEB_TRIAL === '1';
}

function shanghaiDay(now = Date.now()): string {
  return new Date(now + SHANGHAI_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function secondsUntilNextShanghaiDay(now = Date.now()): number {
  const shifted = new Date(now + SHANGHAI_UTC_OFFSET_MS);
  const nextDayUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((nextDayUtc - shifted.getTime()) / 1000));
}

async function hashApiKey(apiKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`magine-web-trial:${apiKey.trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getUsageDatabase(): Promise<MagineTrialD1Database | null> {
  const scope = globalThis as unknown as Record<
    symbol,
    { env?: { WEB_TRIAL_USAGE_DB?: MagineTrialD1Database } } | undefined
  >;
  return scope[CLOUDFLARE_CONTEXT_SYMBOL]?.env?.WEB_TRIAL_USAGE_DB || null;
}

export function isGenerationSubmission(targetUrl: URL, method: string | undefined): boolean {
  if (!isWebTrialBuild() || String(method || 'GET').toUpperCase() !== 'POST') return false;

  const path = targetUrl.pathname.toLowerCase();
  const excluded = [
    'recordinfo',
    'record-info',
    '/query/',
    '/query?',
    '/status/',
    '/result/',
    '/credit',
    '/balance',
    '/files',
    '/upload',
    '/login',
    '/check',
  ];
  if (excluded.some((part) => `${path}${targetUrl.search}`.includes(part))) return false;
  if (/\/models\/?$/.test(path)) return false;

  return [
    '/chat/completions',
    '/responses',
    '/v1/messages',
    ':generatecontent',
    ':streamgeneratecontent',
    '/images/generations',
    '/images/edits',
    '/videos/generations',
    '/v1/videos/',
    '/audio/speech',
    '/text-to-speech',
    '/voice_design',
    '/t2a_v2',
    '/createtask',
    '/generate/video',
    '/veo/generate',
    '/video_generation',
    '/video-generation/video-synthesis',
    '/contents/generations/tasks',
    '/music/generate',
    '/music_generation',
    '/generate/music',
    '/v1/music/generate',
    '/v1/generate',
  ].some((part) => path.includes(part));
}

export async function consumeWebTrialGeneration(apiKey: string): Promise<TrialGenerationLimitResult> {
  const disabled: TrialGenerationLimitResult = {
    enabled: false,
    allowed: true,
    limit: DAILY_GENERATION_LIMIT,
    used: 0,
    remaining: DAILY_GENERATION_LIMIT,
    retryAfterSeconds: 0,
  };
  if (!isWebTrialBuild()) return disabled;

  const db = await getUsageDatabase();
  if (!db) {
    return {
      ...disabled,
      enabled: true,
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    };
  }

  try {
    const now = new Date().toISOString();
    const day = shanghaiDay();
    const subjectHash = await hashApiKey(apiKey);
    const statements = [
      db.prepare(
        `INSERT OR IGNORE INTO web_trial_generation_usage
          (usage_day, subject_hash, generation_count, updated_at)
         VALUES (?, ?, 0, ?)`,
      ).bind(day, subjectHash, now),
      db.prepare(
        `UPDATE web_trial_generation_usage
         SET generation_count = generation_count + 1, updated_at = ?
         WHERE usage_day = ? AND subject_hash = ? AND generation_count < ?`,
      ).bind(now, day, subjectHash, DAILY_GENERATION_LIMIT),
      db.prepare(
        `SELECT generation_count
         FROM web_trial_generation_usage
         WHERE usage_day = ? AND subject_hash = ?`,
      ).bind(day, subjectHash),
    ];
    const results = await db.batch(statements);
    const updateChanges = Number(results[1]?.meta?.changes || 0);
    const row = results[2]?.results?.[0] as { generation_count?: number } | undefined;
    const used = Math.max(0, Number(row?.generation_count || 0));

    return {
      enabled: true,
      allowed: updateChanges > 0,
      limit: DAILY_GENERATION_LIMIT,
      used,
      remaining: Math.max(0, DAILY_GENERATION_LIMIT - used),
      retryAfterSeconds: secondsUntilNextShanghaiDay(),
    };
  } catch {
    return {
      ...disabled,
      enabled: true,
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    };
  }
}

export function applyTrialLimitHeaders(
  setHeader: (name: string, value: string) => void,
  result: TrialGenerationLimitResult,
): void {
  if (!result.enabled) return;
  setHeader('X-Magine-Trial-Limit', String(result.limit));
  setHeader('X-Magine-Trial-Remaining', String(result.remaining));
  setHeader('Cache-Control', 'no-store');
}

export function trialLimitErrorBody(result: TrialGenerationLimitResult) {
  const unavailable = result.used === 0 && result.retryAfterSeconds === 60;
  return {
    error: unavailable ? 'WEB_TRIAL_LIMIT_UNAVAILABLE' : 'WEB_TRIAL_DAILY_LIMIT',
    message: unavailable
      ? '体验版生成计数服务暂时不可用，请稍后重试或使用本地正式版'
      : `体验版每天最多生成 ${DAILY_GENERATION_LIMIT} 次，今日次数已用完，请使用本地正式版`,
    limit: result.limit,
    used: result.used,
    remaining: result.remaining,
  };
}
