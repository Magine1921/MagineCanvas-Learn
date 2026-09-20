import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { EditTimelineIR, MaterializedClipFile } from '@/lib/edit-timeline-ir';
import { getMaterialForClip } from '@/lib/edit-timeline-ir';
import { clipEffectiveDurationMs } from '@/lib/edit-timeline-utils';
import type { EditClip } from '@/lib/edit-timeline-types';

const US_PER_MS = 1000;
const PHOTO_PLACEHOLDER_DURATION_US = 10_800_000_000;
const JIANYING_SCHEMA_VERSION = 360000;
const JIANYING_NEW_VERSION = '110.0.0';

type JsonObject = Record<string, unknown>;

export type JianyingCompatProfile = {
  key: string;
  label: string;
  suffix: string;
  appVersion: string;
  versionCode: number;
  newVersion: string;
  note: string;
};

export type JianyingPathOptions = {
  draftDir?: string;
  draftRoot?: string;
  libraryFolders?: JianyingLibraryFolder[];
  libraryMaterials?: JianyingLibraryMaterial[];
  timelineFolderIds?: Record<string, string>;
};

export type JianyingLibraryFolder = {
  id: string;
  name: string;
};

export type JianyingLibraryMaterial = {
  id: string;
  folderId: string;
  folderName: string;
  name: string;
  mediaKind: EditClip['mediaKind'];
  absolutePath: string;
  durationMs?: number;
};

export const JIANYING_10_6_PROFILE: JianyingCompatProfile = {
  key: 'jianying_10_6_0',
  label: '剪映 10.6.0 草稿',
  suffix: 'jianying_10_6_0',
  appVersion: '10.6.0',
  versionCode: JIANYING_SCHEMA_VERSION,
  newVersion: JIANYING_NEW_VERSION,
  note: '面向剪映专业版 10.6.0，使用完整草稿模板、绝对素材路径和 speed 引用。',
};

export const JIANYING_COMPAT_PROFILES: readonly JianyingCompatProfile[] = [
  JIANYING_10_6_PROFILE,
];

export function createJianyingDraftId(profileKey = 'draft'): string {
  return hashId(`${profileKey}:${randomUUID()}`);
}

export function getDefaultJianyingDraftRoot(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
}

export function sanitizeJianyingDraftName(name: string): string {
  const safe = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return safe || 'MagineCanvas_Edit';
}

function hashId(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function micros(ms: number): number {
  return Math.max(0, Math.round(ms * US_PER_MS));
}

function posixAbs(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

function materialIdForClip(clipId: string): string {
  return hashId(`material:${clipId}`);
}

function speedIdForClip(clipId: string): string {
  return hashId(`speed:${clipId}`);
}

function segmentIdForClip(clipId: string): string {
  return hashId(`segment:${clipId}:${randomUUID()}`);
}

function materialDisplayName(clip: EditClip, mat: MaterializedClipFile): string {
  return clip.fileName || mat.fileName || path.basename(mat.absolutePath);
}

function materialResourceAbsolutePath(mat: MaterializedClipFile, opts?: JianyingPathOptions): string {
  if (opts?.draftDir) {
    const draftDir = path.resolve(opts.draftDir);
    const materialPath = path.resolve(mat.absolutePath);
    const relativeToDraft = path.relative(draftDir, materialPath);
    if (relativeToDraft && !relativeToDraft.startsWith('..') && !path.isAbsolute(relativeToDraft)) {
      return posixAbs(materialPath);
    }
    return posixAbs(path.join(opts.draftDir, 'Resources', path.basename(mat.absolutePath)));
  }
  return posixAbs(mat.absolutePath);
}

function materialDurationUs(clip: EditClip, materialType: 'video' | 'photo' | 'audio'): number {
  if (materialType === 'photo') return PHOTO_PLACEHOLDER_DURATION_US;
  return micros(Math.max(clip.durationMs ?? 0, clip.outMs, clip.inMs + clipEffectiveDurationMs(clip)));
}

function libraryMaterialPair(material: JianyingLibraryMaterial): {
  clip: EditClip;
  file: MaterializedClipFile;
} {
  const durationMs = Math.max(1, material.durationMs || 3000);
  const clipId = `library:${material.id}`;
  const displayName = `[${material.folderName}] ${material.name}`;
  return {
    clip: {
      id: clipId,
      sourceNodeId: material.id,
      sourceKind: 'material',
      mediaKind: material.mediaKind,
      url: material.absolutePath,
      fileName: displayName,
      durationMs,
      inMs: 0,
      outMs: durationMs,
      timelineStartMs: 0,
      trackIndex: material.mediaKind === 'audio' ? 1 : 0,
    },
    file: {
      clipId,
      relativePath: '',
      absolutePath: material.absolutePath,
      mediaKind: material.mediaKind,
      fileName: displayName,
    },
  };
}

function platformInfo(profile: JianyingCompatProfile): JsonObject {
  return {
    app_id: 3704,
    app_source: 'lv',
    app_version: profile.appVersion,
    os: 'windows',
  };
}

function templateMaterials(): JsonObject {
  return {
    ai_translates: [],
    audio_balances: [],
    audio_effects: [],
    audio_fades: [],
    audio_track_indexes: [],
    audios: [],
    beats: [],
    canvases: [],
    chromas: [],
    color_curves: [],
    digital_humans: [],
    drafts: [],
    effects: [],
    flowers: [],
    green_screens: [],
    handwrites: [],
    hsl: [],
    images: [],
    log_color_wheels: [],
    loudnesses: [],
    manual_deformations: [],
    masks: [],
    material_animations: [],
    material_colors: [],
    multi_language_refs: [],
    placeholders: [],
    plugin_effects: [],
    primary_color_wheels: [],
    realtime_denoises: [],
    shapes: [],
    smart_crops: [],
    smart_relights: [],
    sound_channel_mappings: [],
    speeds: [],
    stickers: [],
    tail_leaders: [],
    text_templates: [],
    texts: [],
    time_marks: [],
    transitions: [],
    video_effects: [],
    video_trackings: [],
    videos: [],
    vocal_beautifys: [],
    vocal_separations: [],
  };
}

function cropSettings(): JsonObject {
  return {
    upper_left_x: 0,
    upper_left_y: 0,
    upper_right_x: 1,
    upper_right_y: 0,
    lower_left_x: 0,
    lower_left_y: 1,
    lower_right_x: 1,
    lower_right_y: 1,
  };
}

function clipSettings(): JsonObject {
  return {
    alpha: 1,
    flip: {
      horizontal: false,
      vertical: false,
    },
    rotation: 0,
    scale: {
      x: 1,
      y: 1,
    },
    transform: {
      x: 0,
      y: 0,
    },
  };
}

function buildVideoMaterial(
  ir: EditTimelineIR,
  clip: EditClip,
  mat: MaterializedClipFile,
  opts?: JianyingPathOptions
): JsonObject {
  const type = clip.mediaKind === 'image' ? 'photo' : 'video';
  const materialId = materialIdForClip(clip.id);
  return {
    audio_fade: null,
    category_id: '',
    category_name: 'local',
    check_flag: 63487,
    crop: cropSettings(),
    crop_ratio: 'free',
    crop_scale: 1,
    duration: materialDurationUs(clip, type),
    height: ir.sequence.height,
    id: materialId,
    local_material_id: '',
    material_id: materialId,
    material_name: materialDisplayName(clip, mat),
    media_path: '',
    path: materialResourceAbsolutePath(mat, opts),
    type,
    width: ir.sequence.width,
  };
}

function buildAudioMaterial(
  clip: EditClip,
  mat: MaterializedClipFile,
  opts?: JianyingPathOptions
): JsonObject {
  const materialId = materialIdForClip(clip.id);
  return {
    app_id: 0,
    category_id: '',
    category_name: 'local',
    check_flag: 3,
    copyright_limit_type: 'none',
    duration: materialDurationUs(clip, 'audio'),
    effect_id: '',
    formula_id: '',
    id: materialId,
    local_material_id: materialId,
    music_id: materialId,
    name: materialDisplayName(clip, mat),
    path: materialResourceAbsolutePath(mat, opts),
    source_platform: 0,
    type: 'extract_music',
    wave_points: [],
  };
}

function buildSpeedMaterial(clip: EditClip): JsonObject {
  return {
    curve_speed: null,
    id: speedIdForClip(clip.id),
    mode: 0,
    speed: 1,
    type: 'speed',
  };
}

function baseSegment(clip: EditClip): JsonObject {
  const durationUs = micros(clipEffectiveDurationMs(clip));
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id: segmentIdForClip(clip.id),
    material_id: materialIdForClip(clip.id),
    target_timerange: {
      start: micros(clip.timelineStartMs),
      duration: durationUs,
    },
    common_keyframes: [],
    keyframe_refs: [],
    source_timerange: {
      start: clip.mediaKind === 'image' ? 0 : micros(clip.inMs),
      duration: durationUs,
    },
    speed: 1,
    volume: 1,
    extra_material_refs: [speedIdForClip(clip.id)],
    is_tone_modify: false,
  };
}

function buildVideoSegment(clip: EditClip, renderIndex: number): JsonObject {
  return {
    ...baseSegment(clip),
    clip: clipSettings(),
    uniform_scale: {
      on: true,
      value: 1,
    },
    hdr_settings: {
      intensity: 1,
      mode: 1,
      nits: 1000,
    },
    render_index: renderIndex,
  };
}

function buildAudioSegment(clip: EditClip, renderIndex: number): JsonObject {
  return {
    ...baseSegment(clip),
    clip: null,
    hdr_settings: null,
    render_index: renderIndex,
  };
}

function buildTrack(type: 'video' | 'audio', clips: EditClip[], renderIndex: number): JsonObject {
  const segments = clips
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs)
    .map((clip) => (type === 'audio' ? buildAudioSegment(clip, renderIndex) : buildVideoSegment(clip, renderIndex)));
  return {
    attribute: 0,
    flag: 0,
    id: hashId(`track:${type}:${randomUUID()}`),
    is_default_name: false,
    name: type,
    segments,
    type,
  };
}

function splitMaterials(ir: EditTimelineIR, opts?: JianyingPathOptions): JsonObject {
  const materials = templateMaterials();
  const videos: JsonObject[] = [];
  const audios: JsonObject[] = [];
  const speeds: JsonObject[] = [];

  for (const clip of ir.clips) {
    const mat = getMaterialForClip(ir, clip.id);
    if (!mat) continue;
    speeds.push(buildSpeedMaterial(clip));
    if (clip.mediaKind === 'audio') {
      audios.push(buildAudioMaterial(clip, mat, opts));
    } else {
      videos.push(buildVideoMaterial(ir, clip, mat, opts));
    }
  }

  for (const libraryMaterial of opts?.libraryMaterials || []) {
    const { clip, file } = libraryMaterialPair(libraryMaterial);
    if (clip.mediaKind === 'audio') {
      audios.push(buildAudioMaterial(clip, file));
    } else {
      videos.push(buildVideoMaterial(ir, clip, file));
    }
  }

  materials.videos = videos;
  materials.audios = audios;
  materials.speeds = speeds;
  return materials;
}

function splitTracks(ir: EditTimelineIR): JsonObject[] {
  const tracks: JsonObject[] = [];
  const visualGroups = groupClipsByTrack(ir.clips.filter((clip) => clip.mediaKind !== 'audio'));
  const audioGroups = groupClipsByTrack(ir.clips.filter((clip) => clip.mediaKind === 'audio'));
  visualGroups.forEach((clips, index) => tracks.push(buildTrack('video', clips, index)));
  audioGroups.forEach((clips, index) => tracks.push(buildTrack('audio', clips, index)));
  if (tracks.length === 0) tracks.push(buildTrack('video', [], 0));
  return tracks;
}

function groupClipsByTrack(clips: EditClip[]): EditClip[][] {
  const byTrack = new Map<number, EditClip[]>();
  for (const clip of clips) {
    const group = byTrack.get(clip.trackIndex) || [];
    group.push(clip);
    byTrack.set(clip.trackIndex, group);
  }
  return [...byTrack.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group.sort((a, b) => a.timelineStartMs - b.timelineStartMs));
}

export function buildJianyingDraftContent(
  ir: EditTimelineIR,
  draftName: string,
  profile: JianyingCompatProfile = JIANYING_10_6_PROFILE,
  draftId: string = createJianyingDraftId(profile.key),
  opts?: JianyingPathOptions
): JsonObject {
  const nowUs = Date.now() * US_PER_MS;
  return {
    canvas_config: {
      height: ir.sequence.height,
      ratio: 'original',
      width: ir.sequence.width,
    },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: '',
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: 'none',
      multi_language_list: [],
      multi_language_main: 'none',
      multi_language_mode: 'none',
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: '',
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: nowUs,
    duration: micros(ir.totalDurationMs),
    extra_info: null,
    fps: ir.sequence.fps,
    free_render_index_mode_on: false,
    group_container: null,
    id: draftId,
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: [],
    },
    last_modified_platform: platformInfo(profile),
    platform: platformInfo(profile),
    materials: splitMaterials(ir, opts),
    mutable_config: null,
    name: draftName,
    new_version: profile.newVersion,
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks: splitTracks(ir),
    update_time: nowUs,
    version: profile.versionCode,
  };
}

function metaMaterialForClip(
  ir: EditTimelineIR,
  clip: EditClip,
  mat: MaterializedClipFile,
  opts?: JianyingPathOptions
): JsonObject {
  const mediaType = clip.mediaKind === 'audio' ? 'audio' : clip.mediaKind === 'image' ? 'photo' : 'video';
  const absPath = materialResourceAbsolutePath(mat, opts);
  return {
    create_time: Date.now() * US_PER_MS,
    duration: micros(clipEffectiveDurationMs(clip)),
    extra_info: '',
    file_Path: absPath,
    height: clip.mediaKind === 'audio' ? 0 : ir.sequence.height,
    id: materialIdForClip(clip.id),
    import_time: Math.floor(Date.now() / 1000),
    metetype: mediaType === 'audio' ? 'video' : mediaType,
    name: materialDisplayName(clip, mat),
    path: absPath,
    type: 0,
    width: clip.mediaKind === 'audio' ? 0 : ir.sequence.width,
  };
}

function metaMaterials(ir: EditTimelineIR, opts?: JianyingPathOptions): JsonObject[] {
  const type0: JsonObject[] = [];
  for (const clip of ir.clips) {
    const mat = getMaterialForClip(ir, clip.id);
    if (!mat) continue;
    type0.push(metaMaterialForClip(ir, clip, mat, opts));
  }

  for (const libraryMaterial of opts?.libraryMaterials || []) {
    const { clip, file } = libraryMaterialPair(libraryMaterial);
    type0.push(metaMaterialForClip(ir, clip, file));
  }

  return [
    { type: 0, value: type0 },
    { type: 1, value: [] },
    { type: 2, value: [] },
    { type: 3, value: [] },
    { type: 6, value: [] },
    { type: 7, value: [] },
    { type: 8, value: [] },
  ];
}

export function buildJianyingMetaInfo(
  ir: EditTimelineIR,
  draftName: string,
  draftFolderPath: string,
  profile: JianyingCompatProfile = JIANYING_10_6_PROFILE,
  draftId: string = createJianyingDraftId(profile.key),
  opts?: JianyingPathOptions
): JsonObject {
  const draftRoot = opts?.draftRoot || path.dirname(draftFolderPath);
  return {
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: '',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: '',
      enterprise_material: [],
    },
    draft_fold_path: posixAbs(draftFolderPath),
    draft_id: draftId,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_materials: metaMaterials(ir, opts),
    draft_materials_copied_info: [],
    draft_name: draftName,
    draft_new_version: profile.newVersion,
    draft_removable_storage_device: '',
    draft_root_path: posixAbs(draftRoot),
    draft_segment_extra_info: [],
    draft_type: 'local',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_removed: 0,
    tm_duration: micros(ir.totalDurationMs),
  };
}

export function buildJianyingMateInfo(
  ir: EditTimelineIR,
  draftName: string,
  draftFolderPath: string,
  profile: JianyingCompatProfile = JIANYING_10_6_PROFILE,
  draftId: string = createJianyingDraftId(profile.key),
  opts?: JianyingPathOptions
): JsonObject {
  return buildJianyingMetaInfo(ir, draftName, draftFolderPath, profile, draftId, opts);
}

function virtualFolderId(folderId: string): string {
  const id = hashId(`virtual-folder:${folderId}`);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export function buildJianyingVirtualStore(
  ir: EditTimelineIR,
  opts?: JianyingPathOptions
): JsonObject {
  const nowMs = Date.now();
  const folders = new Map<string, { id: string; name: string }>();
  for (const folder of opts?.libraryFolders || []) {
    if (!folders.has(folder.id)) {
      folders.set(folder.id, {
        id: virtualFolderId(folder.id),
        name: folder.name,
      });
    }
  }
  for (const material of opts?.libraryMaterials || []) {
    if (!folders.has(material.folderId)) {
      folders.set(material.folderId, {
        id: virtualFolderId(material.folderId),
        name: material.folderName,
      });
    }
  }

  const folderEntries: JsonObject[] = [
    {
      creation_time: 0,
      display_name: '',
      filter_type: 0,
      id: '',
      import_time: 0,
      import_time_us: 0,
      material_color_tag: '',
      sort_sub_type: 0,
      sort_type: 0,
      subdraft_filter_type: 0,
    },
    ...[...folders.values()].map((folder) => ({
      creation_time: Math.floor(nowMs / 1000),
      display_name: folder.name,
      filter_type: 0,
      id: folder.id,
      import_time: Math.floor(nowMs / 1000),
      import_time_us: nowMs * US_PER_MS,
      material_color_tag: '',
      sort_sub_type: 0,
      sort_type: 0,
      subdraft_filter_type: 0,
    })),
  ];

  const relationships: JsonObject[] = [];
  const relatedIds = new Set<string>();
  const addRelationship = (childId: string, parentId: string) => {
    if (!childId || relatedIds.has(childId)) return;
    relatedIds.add(childId);
    relationships.push({ child_id: childId, parent_id: parentId });
  };

  for (const clip of ir.clips) {
    if (!getMaterialForClip(ir, clip.id)) continue;
    const folderId = opts?.timelineFolderIds?.[clip.id] || '';
    addRelationship(materialIdForClip(clip.id), folders.get(folderId)?.id || '');
  }
  for (const folder of folders.values()) {
    addRelationship(folder.id, '');
  }
  for (const material of opts?.libraryMaterials || []) {
    const folder = folders.get(material.folderId);
    const { clip } = libraryMaterialPair(material);
    addRelationship(materialIdForClip(clip.id), folder?.id || '');
  }

  return {
    draft_materials: [],
    draft_virtual_store: [
      { type: 0, value: folderEntries },
      { type: 1, value: relationships },
      { type: 2, value: [] },
    ],
  };
}

export function buildJianyingVariantReadme(profile: JianyingCompatProfile, installedPath?: string): string {
  return `MagineCanvas 剪映 10.6.0 工程

目标版本：${profile.appVersion}
工程结构：draft_content.json + draft_meta_info.json + Resources/
素材路径：已写入本机绝对路径，避免剪映 10.6.0 打开时素材丢失。
分类素材：Resources/序列素材/ 下按序列保存；素材同时注册到草稿媒体库，并以“[序列名] 素材名”显示。

${installedPath ? `已自动写入本机剪映草稿目录：\n${installedPath}\n` : ''}
打开方式：
1. 完全退出剪映后重新打开。
2. 在本地草稿列表中查找该工程名。
3. 如果你的剪映使用了自定义草稿目录，请把整个工程文件夹复制到自定义草稿目录；JSON 内素材仍会指向本机已安装的 Resources 文件。
`;
}

export function buildJianyingReadme(installedPath?: string): string {
  return `MagineCanvas 剪映 10.6.0 兼容工程包

本次导出按剪映 10.6.0 草稿格式生成：
- 草稿文件夹不使用 .draft 后缀。
- draft_content.json 使用 version=360000、new_version=110.0.0。
- 素材路径使用绝对路径。
- Resources/序列素材/ 按序列保存全部素材，并附带素材清单。
- 分类素材同时注册到剪映草稿媒体库，名称带对应序列前缀。
- segment.extra_material_refs 已补齐 speed 素材引用。
- 包含 draft_meta_info.json、draft_mate_info.json、draft_virtual_store.json、draft_cover.jpg、draft_local_cover.jpg。

${installedPath ? `已自动安装到：\n${installedPath}\n` : ''}
若剪映没有立即显示该草稿，请完全退出剪映后重新打开。`;
}
