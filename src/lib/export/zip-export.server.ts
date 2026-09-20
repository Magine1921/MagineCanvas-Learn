import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

type ZipArchiveLike = Readable & {
  file(filename: string, data: { name: string }): ZipArchiveLike;
  finalize(): Promise<void>;
  on(event: 'data', listener: (chunk: Buffer) => void): ZipArchiveLike;
  on(event: 'error', listener: (error: Error) => void): ZipArchiveLike;
  on(event: 'end', listener: () => void): ZipArchiveLike;
};

export async function zipDirectoryToBuffer(dir: string): Promise<Buffer> {
  const files = await listFilesRecursive(dir);
  const { ZipArchive } = (await import('archiver')) as unknown as {
    ZipArchive: new (options?: { zlib?: { level?: number } }) => ZipArchiveLike;
  };
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    for (const abs of files) {
      const rel = path.relative(dir, abs).replace(/\\/g, '/');
      archive.file(abs, { name: rel });
    }
    archive.finalize().catch(reject);
  });
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else out.push(p);
    }
  }
  await walk(root);
  return out;
}

export function bufferToWebReadable(buf: Buffer): Readable {
  return Readable.from(buf);
}
