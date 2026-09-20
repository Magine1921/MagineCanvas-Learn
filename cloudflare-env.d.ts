interface MagineTrialD1Result {
  results?: unknown[];
  meta?: { changes?: number };
}

interface MagineTrialD1Statement {
  bind(...values: unknown[]): MagineTrialD1Statement;
}

interface MagineTrialD1Database {
  prepare(query: string): MagineTrialD1Statement;
  batch(statements: MagineTrialD1Statement[]): Promise<MagineTrialD1Result[]>;
}

interface MagineMediaR2HttpMetadata {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
}

interface MagineMediaR2Object {
  key: string;
  size: number;
  httpEtag?: string;
  httpMetadata?: MagineMediaR2HttpMetadata;
  customMetadata?: Record<string, string>;
}

interface MagineMediaR2ObjectBody extends MagineMediaR2Object {
  body: ReadableStream<Uint8Array>;
  range?: { offset: number; length: number };
}

interface MagineMediaR2Bucket {
  head(key: string): Promise<MagineMediaR2Object | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<MagineMediaR2ObjectBody | null>;
  put(
    key: string,
    value: unknown,
    options?: {
      httpMetadata?: MagineMediaR2HttpMetadata;
      customMetadata?: Record<string, string>;
    },
  ): Promise<MagineMediaR2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: MagineMediaR2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
}

interface CloudflareEnv {
  WEB_TRIAL_USAGE_DB?: MagineTrialD1Database;
  WEB_TRIAL_MEDIA_BUCKET?: MagineMediaR2Bucket;
}
