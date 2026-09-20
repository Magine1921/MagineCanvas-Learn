import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import type {
  EditClip,
  EditClipSourceKind,
  EditExportFormat,
  EditMediaKind,
  EditSequenceSettings,
} from '@/lib/edit-timeline-types';
import { buildEditTimelineIR } from '@/lib/edit-timeline-ir';
import { normalizeSequence } from '@/lib/edit-timeline-utils';
import { materializeClipsForExport } from '@/lib/export/materialize-clips.server';
import { buildAeAepxProject, buildAeExtendScript, buildAeReadme } from '@/lib/export/ae-aepx-exporter.server';
import {
  buildJianyingDraftContent,
  buildJianyingMateInfo,
  buildJianyingMetaInfo,
  buildJianyingReadme,
  buildJianyingVariantReadme,
  buildJianyingVirtualStore,
  createJianyingDraftId,
  getDefaultJianyingDraftRoot,
  JIANYING_10_6_PROFILE,
  sanitizeJianyingDraftName,
  type JianyingLibraryMaterial,
} from '@/lib/export/jianying-exporter.server';
import {
  buildNativePremiereReadme,
  createNativePremiereProject,
} from '@/lib/export/premiere-native-exporter.server';
import { buildFcp7Xmeml } from '@/lib/export/xmeml-exporter.server';
import { zipDirectoryToBuffer } from '@/lib/export/zip-export.server';
import { getMagineCacheRoot } from '@/lib/magine-cache-root.server';

export const maxDuration = 300;

function getExportRoot(): string {
  return path.join(getMagineCacheRoot(), 'edit-exports');
}

function parseClips(raw: unknown): EditClip[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is EditClip => {
    if (!c || typeof c !== 'object') return false;
    const o = c as EditClip;
    return typeof o.id === 'string' && typeof o.url === 'string' && typeof o.mediaKind === 'string';
  });
}

async function nextJianyingDraftCopy(
  draftRoot: string,
  baseDraftName: string,
): Promise<{ draftName: string; folderName: string }> {
  for (let copyIndex = 0; copyIndex < 10000; copyIndex += 1) {
    const draftName = copyIndex === 0
      ? baseDraftName
      : copyIndex === 1
        ? `${baseDraftName}_副本`
        : `${baseDraftName}_副本${copyIndex}`;
    const folderName = `${draftName}_MagineCanvas_10_6_0`;
    try {
      await fs.access(path.join(draftRoot, folderName));
    } catch {
      return { draftName, folderName };
    }
  }
  throw new Error('导演组合工程副本数量过多，请整理剪映草稿后重试');
}

interface ExportMediaFolderAsset {
  id: string;
  name: string;
  mediaKind: EditMediaKind;
  url: string;
  sourceNodeId: string;
  sourceKind: EditClipSourceKind;
  thumbnailUrl?: string;
  durationMs?: number;
}

interface ExportMediaFolder {
  id: string;
  name: string;
  assets: ExportMediaFolderAsset[];
}

interface MaterializedExportMediaFolder {
  id: string;
  name: string;
  directory: string;
  absolutePaths: string[];
  assets: Array<{
    id: string;
    name: string;
    mediaKind: EditMediaKind;
    durationMs?: number;
    sourceUrl: string;
    absolutePath: string;
  }>;
}

function safeExportFolderName(value: string, fallback: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .slice(0, 80) || fallback;
}

function parseMediaFolders(raw: unknown): ExportMediaFolder[] {
  if (!Array.isArray(raw)) return [];
  const seenFolders = new Set<string>();
  return raw.flatMap((item, folderIndex) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Partial<ExportMediaFolder>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id || seenFolders.has(id)) return [];
    seenFolders.add(id);
    const assets = Array.isArray(value.assets)
      ? value.assets.flatMap((asset, assetIndex) => {
          if (!asset || typeof asset !== 'object') return [];
          const candidate = asset as Partial<ExportMediaFolderAsset>;
          const mediaKind = candidate.mediaKind;
          const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
          if (!url || !['video', 'image', 'audio'].includes(String(mediaKind))) return [];
          return [{
            id: typeof candidate.id === 'string' && candidate.id.trim()
              ? candidate.id.trim()
              : `${id}:${assetIndex}`,
            name: typeof candidate.name === 'string' && candidate.name.trim()
              ? candidate.name.trim()
              : `素材 ${assetIndex + 1}`,
            mediaKind: mediaKind as EditMediaKind,
            url,
            sourceNodeId: typeof candidate.sourceNodeId === 'string'
              ? candidate.sourceNodeId
              : id,
            sourceKind: candidate.sourceKind || 'material',
            thumbnailUrl: typeof candidate.thumbnailUrl === 'string'
              ? candidate.thumbnailUrl
              : undefined,
            durationMs: Number.isFinite(Number(candidate.durationMs))
              ? Number(candidate.durationMs)
              : undefined,
          }];
        })
      : [];
    return [{
      id,
      name: safeExportFolderName(
        typeof value.name === 'string' ? value.name : '',
        `序列 ${folderIndex + 1}`,
      ),
      assets,
    }];
  });
}

async function materializeExportMediaFolders(opts: {
  folders: ExportMediaFolder[];
  workDir: string;
  req: NextRequest;
}): Promise<MaterializedExportMediaFolder[]> {
  const root = path.join(opts.workDir, '序列素材');
  await fs.mkdir(root, { recursive: true });
  const usedNames = new Set<string>();
  const output: MaterializedExportMediaFolder[] = [];
  for (let folderIndex = 0; folderIndex < opts.folders.length; folderIndex += 1) {
    const folder = opts.folders[folderIndex];
    let directoryName = safeExportFolderName(folder.name, `序列 ${folderIndex + 1}`);
    if (usedNames.has(directoryName)) directoryName = `${directoryName}-${folderIndex + 1}`;
    usedNames.add(directoryName);
    const directory = path.join(root, directoryName);
    const clips: EditClip[] = folder.assets.map((asset, assetIndex) => {
      const durationMs = Math.max(1, asset.durationMs || 3000);
      return {
        id: `folder-${folder.id}-${asset.id}-${assetIndex}`,
        sourceNodeId: asset.sourceNodeId,
        sourceKind: asset.sourceKind,
        mediaKind: asset.mediaKind,
        url: asset.url,
        fileName: asset.name,
        thumbnailUrl: asset.thumbnailUrl,
        durationMs,
        inMs: 0,
        outMs: durationMs,
        timelineStartMs: 0,
        trackIndex: asset.mediaKind === 'audio' ? 1 : 0,
      };
    });
    const files = clips.length
      ? await materializeClipsForExport({
          clips,
          workDir: directory,
          req: opts.req,
          mediaDirectoryName: '',
        })
      : [];
    await fs.mkdir(directory, { recursive: true });
    const materializedAssets = files.map((file, assetIndex) => ({
      id: folder.assets[assetIndex]?.id || file.clipId,
      name: folder.assets[assetIndex]?.name || file.fileName,
      mediaKind: file.mediaKind,
      durationMs: folder.assets[assetIndex]?.durationMs,
      sourceUrl: folder.assets[assetIndex]?.url || '',
      absolutePath: file.absolutePath,
    }));
    await fs.writeFile(
      path.join(directory, '素材清单.json'),
      JSON.stringify({
        id: folder.id,
        name: folder.name,
        assetCount: materializedAssets.length,
        assets: materializedAssets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          mediaKind: asset.mediaKind,
          fileName: path.basename(asset.absolutePath),
        })),
      }, null, 2),
      'utf8',
    );
    output.push({
      id: folder.id,
      name: folder.name,
      directory,
      absolutePaths: files.map((file) => file.absolutePath),
      assets: materializedAssets,
    });
  }
  await fs.writeFile(
    path.join(root, '序列素材清单.json'),
    JSON.stringify({
      folderCount: output.length,
      assetCount: output.reduce((total, folder) => total + folder.assets.length, 0),
      folders: output.map((folder) => ({
        id: folder.id,
        name: folder.name,
        directoryName: path.basename(folder.directory),
        assetCount: folder.assets.length,
      })),
    }, null, 2),
    'utf8',
  );
  return output;
}

async function nextDirectExportDirectory(
  outputRoot: string,
  baseName: string,
): Promise<string> {
  await fs.mkdir(outputRoot, { recursive: true });
  for (let copyIndex = 0; copyIndex < 10000; copyIndex += 1) {
    const folderName = copyIndex === 0
      ? baseName
      : copyIndex === 1
        ? `${baseName}_副本`
        : `${baseName}_副本${copyIndex}`;
    const target = path.join(outputRoot, folderName);
    try {
      await fs.access(target);
    } catch {
      return target;
    }
  }
  throw new Error('工程副本数量过多，请整理导出目录后重试');
}

function parseOutputDirectory(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : '';
}

async function writeJianyingCoverFiles(draftDir: string): Promise<void> {
  const cover = await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 3,
      background: '#111827',
    },
  })
    .jpeg({ quality: 86 })
    .toBuffer();

  await fs.writeFile(path.join(draftDir, 'draft_cover.jpg'), cover);
  await fs.writeFile(path.join(draftDir, 'draft_local_cover.jpg'), cover);
}

async function writeJianying106Draft(opts: {
  workDir: string;
  draftName: string;
  ir: ReturnType<typeof buildEditTimelineIR>;
  materials: Awaited<ReturnType<typeof materializeClipsForExport>>;
  sequenceMediaRoot?: string;
  sequenceMediaFolders?: MaterializedExportMediaFolder[];
  draftRoot?: string;
}): Promise<{ installedDraftDir: string; zipDraftFolderName: string }> {
  const { workDir, draftName, ir, materials } = opts;
  const profile = JIANYING_10_6_PROFILE;
  const baseDraftName = sanitizeJianyingDraftName(draftName);
  const jianyingDraftRoot = opts.draftRoot || getDefaultJianyingDraftRoot();
  await fs.mkdir(jianyingDraftRoot, { recursive: true });
  const {
    draftName: safeDraftName,
    folderName: zipDraftFolderName,
  } = await nextJianyingDraftCopy(jianyingDraftRoot, baseDraftName);
  const installedDraftDir = path.join(jianyingDraftRoot, zipDraftFolderName);
  const installedResourcesDir = path.join(installedDraftDir, 'Resources');

  await fs.mkdir(installedResourcesDir, { recursive: true });
  const installedSequenceMediaRoot = path.join(installedResourcesDir, '序列素材');
  if (opts.sequenceMediaRoot) {
    await fs.cp(opts.sequenceMediaRoot, installedSequenceMediaRoot, { recursive: true });
  }

  const installedFolderAssets = (opts.sequenceMediaFolders || []).flatMap((folder) => {
    const directoryName = path.basename(folder.directory);
    return folder.assets.map((asset) => ({
      ...asset,
      folderId: folder.id,
      folderName: folder.name,
      installedAbsolutePath: path.join(
        installedSequenceMediaRoot,
        directoryName,
        path.basename(asset.absolutePath),
      ),
    }));
  });

  const folderAssetByUrl = new Map<string, typeof installedFolderAssets[number]>();
  for (const asset of installedFolderAssets) {
    const key = `${asset.folderId}\u0000${asset.sourceUrl}`;
    if (asset.sourceUrl && !folderAssetByUrl.has(key)) folderAssetByUrl.set(key, asset);
  }

  const timelineFolderIds: Record<string, string> = {};
  const usedFolderAssetIds = new Set<string>();
  const timelineMaterialPaths = new Map<string, string>();
  for (const clip of ir.clips) {
    const folderId = clip.mediaFolderId || '';
    if (!folderId) continue;
    timelineFolderIds[clip.id] = folderId;
    const asset = folderAssetByUrl.get(`${folderId}\u0000${clip.url}`);
    if (!asset) continue;
    usedFolderAssetIds.add(`${asset.folderId}\u0000${asset.id}`);
    timelineMaterialPaths.set(clip.id, asset.installedAbsolutePath);
  }

  for (const material of materials) {
    if (timelineMaterialPaths.has(material.clipId)) continue;
    await fs.copyFile(
      material.absolutePath,
      path.join(installedResourcesDir, path.basename(material.absolutePath)),
    );
  }
  const draftIr = {
    ...ir,
    materials: ir.materials.map((material) => ({
      ...material,
      absolutePath: timelineMaterialPaths.get(material.clipId) || material.absolutePath,
    })),
  };

  const libraryMaterials: JianyingLibraryMaterial[] = installedFolderAssets
    .filter((asset) => !usedFolderAssetIds.has(`${asset.folderId}\u0000${asset.id}`))
    .map((asset) => ({
      id: `${asset.folderId}:${asset.id}`,
      folderId: asset.folderId,
      folderName: asset.folderName,
      name: asset.name,
      mediaKind: asset.mediaKind,
      durationMs: asset.durationMs,
      absolutePath: asset.installedAbsolutePath,
    }));

  const draftId = createJianyingDraftId(profile.key);
  const pathOpts = {
    draftDir: installedDraftDir,
    draftRoot: jianyingDraftRoot,
    libraryFolders: (opts.sequenceMediaFolders || []).map((folder) => ({
      id: folder.id,
      name: folder.name,
    })),
    libraryMaterials,
    timelineFolderIds,
  };
  const content = buildJianyingDraftContent(draftIr, safeDraftName, profile, draftId, pathOpts);
  const metaInfo = buildJianyingMetaInfo(draftIr, safeDraftName, installedDraftDir, profile, draftId, pathOpts);

  await fs.writeFile(
    path.join(installedDraftDir, 'draft_content.json'),
    JSON.stringify(content, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(installedDraftDir, 'draft_meta_info.json'),
    JSON.stringify(metaInfo, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(installedDraftDir, 'draft_mate_info.json'),
    JSON.stringify(buildJianyingMateInfo(draftIr, safeDraftName, installedDraftDir, profile, draftId, pathOpts), null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(installedDraftDir, 'draft_virtual_store.json'),
    JSON.stringify(buildJianyingVirtualStore(draftIr, pathOpts), null, 2),
    'utf8'
  );
  await writeJianyingCoverFiles(installedDraftDir);
  await fs.writeFile(
    path.join(installedDraftDir, 'README.txt'),
    buildJianyingVariantReadme(profile, installedDraftDir),
    'utf8'
  );

  if (!opts.draftRoot) {
    await fs.cp(installedDraftDir, path.join(workDir, zipDraftFolderName), { recursive: true });
    await fs.writeFile(path.join(workDir, 'README.txt'), buildJianyingReadme(installedDraftDir), 'utf8');

    const exchangeDir = path.join(workDir, '通用交换');
    await fs.mkdir(exchangeDir, { recursive: true });
    await fs.writeFile(path.join(exchangeDir, 'project.xml'), buildFcp7Xmeml(ir, safeDraftName), 'utf8');
    await fs.writeFile(
      path.join(exchangeDir, 'README.txt'),
      `MagineCanvas 通用交换工程

如果剪映 10.6.0 没有显示自动安装的草稿，可先用 project.xml 作为兜底交换文件导入。
素材原文件位于压缩包 media/ 文件夹，同时剪映草稿 Resources/ 已安装到本机草稿目录。
`,
      'utf8'
    );
  }

  return { installedDraftDir, zipDraftFolderName };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  const format = body.format as EditExportFormat;
  if (
    format !== 'jianying' &&
    format !== 'premiere' &&
    format !== 'aftereffects'
  ) {
    return NextResponse.json(
      { error: 'format 必须为 jianying | premiere | aftereffects' },
      { status: 400 }
    );
  }

  const clips = parseClips(body.clips);
  const mediaFolders = parseMediaFolders(body.mediaFolders);
  if (clips.length === 0) {
    return NextResponse.json({ error: '时间线为空，请先同步素材并添加片段' }, { status: 400 });
  }

  const sequence = normalizeSequence(body.sequence as Partial<EditSequenceSettings> | undefined);
  const draftName = typeof body.draftName === 'string' && body.draftName.trim()
    ? body.draftName.trim().slice(0, 64)
    : 'MagineCanvas_Edit';
  const outputDirectory = parseOutputDirectory(body.outputDirectory);
  if (body.outputDirectory && !outputDirectory) {
    return NextResponse.json({ error: '自定义工程目录必须是绝对路径' }, { status: 400 });
  }

  const jobId = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workDir = path.join(getExportRoot(), jobId);
  let directSavedPath = '';

  try {
    await fs.mkdir(workDir, { recursive: true });
    const materials = await materializeClipsForExport({ clips, workDir, req });
    const materializedMediaFolders = await materializeExportMediaFolders({
      folders: mediaFolders,
      workDir,
      req,
    });
    const ir = buildEditTimelineIR(clips, sequence, materials);
    const mediaFolderCount = materializedMediaFolders.length;
    const mediaAssetCount = materializedMediaFolders.reduce(
      (total, folder) => total + folder.assets.length,
      0,
    );

    if (format === 'premiere') {
      let premiereOutputDir = workDir;
      if (outputDirectory) {
        directSavedPath = await nextDirectExportDirectory(
          outputDirectory,
          `${sanitizeJianyingDraftName(draftName)}_Premiere`,
        );
        await fs.mkdir(directSavedPath, { recursive: true });
        await fs.cp(
          path.join(workDir, 'media'),
          path.join(directSavedPath, 'media'),
          { recursive: true },
        );
        if (materializedMediaFolders.length) {
          await fs.cp(
            path.join(workDir, '序列素材'),
            path.join(directSavedPath, '序列素材'),
            { recursive: true },
          );
        }
        premiereOutputDir = directSavedPath;
      }
      const materialByClipId = new Map(materials.map((material) => [material.clipId, material]));
      const premiereMaterialPath = (relativePath: string) => (
        path.resolve(premiereOutputDir, relativePath)
      );
      const premiereFolderAssetPath = (
        folder: MaterializedExportMediaFolder,
        absolutePath: string,
      ) => path.join(
        premiereOutputDir,
        '序列素材',
        path.basename(folder.directory),
        path.basename(absolutePath),
      );
      await createNativePremiereProject({
        outputDir: premiereOutputDir,
        xmeml: buildFcp7Xmeml(ir, 'MagineCanvas_Edit', premiereOutputDir),
        mediaFolders: materializedMediaFolders.map((folder) => ({
          name: path.basename(folder.directory),
          absolutePaths: folder.absolutePaths.map((absolutePath) => (
            premiereFolderAssetPath(folder, absolutePath)
          )),
          timelineItems: ir.clips.flatMap((clip) => {
            if (clip.mediaFolderId !== folder.id) return [];
            const material = materialByClipId.get(clip.id);
            if (!material) return [];
            const folderAsset = folder.assets.find((asset) => (
              asset.sourceUrl === clip.url && asset.mediaKind === clip.mediaKind
            ));
            return [{
              currentPath: premiereMaterialPath(material.relativePath),
              folderPath: folderAsset
                ? premiereFolderAssetPath(folder, folderAsset.absolutePath)
                : undefined,
            }];
          }),
        })),
      });
      await fs.writeFile(
        path.join(premiereOutputDir, 'README.txt'),
        buildNativePremiereReadme(ir),
        'utf8',
      );
    } else if (format === 'aftereffects') {
      await fs.writeFile(
        path.join(workDir, 'MagineCanvas_Edit.aepx'),
        buildAeAepxProject(ir),
        'utf8'
      );
      await fs.mkdir(path.join(workDir, 'scripts'), { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'scripts', 'build_edit_station_comp.jsx'),
        buildAeExtendScript(ir),
        'utf8'
      );
      await fs.writeFile(path.join(workDir, 'README.txt'), buildAeReadme(ir), 'utf8');
    } else {
      const result = await writeJianying106Draft({
        workDir,
        draftName,
        ir,
        materials,
        sequenceMediaRoot: materializedMediaFolders.length
          ? path.join(workDir, '序列素材')
          : undefined,
        sequenceMediaFolders: materializedMediaFolders,
        draftRoot: outputDirectory || undefined,
      });
      if (outputDirectory) directSavedPath = result.installedDraftDir;
    }

    if (outputDirectory) {
      if (!directSavedPath) {
        const formatLabel = format === 'premiere'
          ? 'Premiere'
          : 'AfterEffects';
        directSavedPath = await nextDirectExportDirectory(
          outputDirectory,
          `${sanitizeJianyingDraftName(draftName)}_${formatLabel}`,
        );
        await fs.cp(workDir, directSavedPath, { recursive: true });
      }
      return NextResponse.json({
        savedPath: directSavedPath,
        mediaFolderCount,
        mediaAssetCount,
      });
    }

    const zipBuf = await zipDirectoryToBuffer(workDir);
    const fileLabel =
      format === 'jianying'
        ? `${sanitizeJianyingDraftName(draftName)}.jianying-10.6.0.zip`
        : format === 'premiere'
          ? 'premiere_pro_project.zip'
          : 'after_effects_project.zip';

    if (body.delivery === 'download-url') {
      const downloadPath = path.join(getExportRoot(), `${jobId}.zip`);
      await fs.writeFile(downloadPath, zipBuf);
      return NextResponse.json({
        downloadUrl: `/api/edit-station/export/download?jobId=${encodeURIComponent(jobId)}&fileName=${encodeURIComponent(fileLabel)}`,
        fileName: fileLabel,
        mediaFolderCount,
        mediaAssetCount,
      });
    }

    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileLabel}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST /api/edit-station/export]', e);
    if (format === 'premiere' && directSavedPath) {
      try {
        await fs.rm(directSavedPath, { recursive: true, force: true });
      } catch {
        /* ignore cleanup failures */
      }
    }
    return NextResponse.json({ error: msg.slice(0, 800) }, { status: 502 });
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failures */
    }
  }
}
