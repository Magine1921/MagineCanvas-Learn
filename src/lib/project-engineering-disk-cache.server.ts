import fs from 'node:fs/promises';
import path from 'node:path';
import { getMagineCacheRoot, MATERIAL_DISK_CACHE_SEGMENT } from '@/lib/magine-cache-root.server';

/** 画布工程自动快照：`<magine-cache>/engineering/<projectId>/auto-<ts>.json` */
export { MATERIAL_DISK_CACHE_SEGMENT };
export const ENGINEERING_DISK_DIR = 'engineering' as const;

const MAX_ENGINEERING_FILES = 3;
const AUTO_PREFIX = 'auto-';

export function getEngineeringDiskCacheRoot(): string {
  return path.join(getMagineCacheRoot(), ENGINEERING_DISK_DIR);
}

/** 与 `createProjectId` 一致：`project_<ts>_<rand>` */
export function assertSafeEngineeringProjectId(projectId: string): string | null {
  if (!projectId || projectId.length > 160) return null;
  if (!/^project_[a-zA-Z0-9_-]+$/.test(projectId)) return null;
  return projectId;
}

async function pruneEngineeringSnapshots(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const auto = names.filter((n) => n.startsWith(AUTO_PREFIX) && n.endsWith('.json'));
  if (auto.length <= MAX_ENGINEERING_FILES) return;
  const stats = await Promise.all(
    auto.map(async (n) => {
      const p = path.join(dir, n);
      try {
        const s = await fs.stat(p);
        return { n, m: s.mtimeMs };
      } catch {
        return { n, m: 0 };
      }
    })
  );
  stats.sort((a, b) => a.m - b.m);
  const toDelete = stats.slice(0, stats.length - MAX_ENGINEERING_FILES);
  await Promise.all(
    toDelete.map(async ({ n }) => {
      try {
        await fs.unlink(path.join(dir, n));
      } catch {
        /* */
      }
    })
  );
}

export async function saveEngineeringProjectSnapshot(
  projectId: string,
  jsonUtf8: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const id = assertSafeEngineeringProjectId(projectId);
  if (!id) return { ok: false, error: 'invalid project id' };
  const root = getEngineeringDiskCacheRoot();
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  const fname = `${AUTO_PREFIX}${Date.now()}.json`;
  const fpath = path.join(dir, fname);
  await fs.writeFile(fpath, jsonUtf8, 'utf8');
  await pruneEngineeringSnapshots(dir);
  return { ok: true, path: fpath };
}
