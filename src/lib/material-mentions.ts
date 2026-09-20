import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import {
  consumerWantsTopazOutboundVideo,
  resolveTopazEffectiveImageUrl,
  resolveTopazEffectiveVideoUrl,
} from '@/lib/resolve-topaz-inbound-url';

export interface MaterialRef {
  nodeId: string;
  slug: string;
  fileUrl: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileType?: string;
  seedanceAssetId?: string;
  seedanceAssetUri?: string;
  seedanceAssetGroupId?: string;
  faceCompliance?: boolean;
  characterMaterial?: boolean;
  characterDescription?: string;
  characterVoiceReferenceUrl?: string;
  characterVoiceFileName?: string;
  characterVoiceTrimStart?: number;
  characterVoiceTrimEnd?: number;
  characterVoiceDuration?: number;
}

export type CharacterMaterialFields = Pick<
  MaterialRef,
  | 'characterMaterial'
  | 'characterDescription'
  | 'characterVoiceReferenceUrl'
  | 'characterVoiceFileName'
  | 'characterVoiceTrimStart'
  | 'characterVoiceTrimEnd'
  | 'characterVoiceDuration'
>;

export function getCharacterMaterialFields(
  data: Record<string, unknown>,
): CharacterMaterialFields {
  if (data.characterMaterialEnabled !== true) return {};
  const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
  return {
    characterMaterial: true,
    characterDescription: stringValue(data.characterDescription) || undefined,
    characterVoiceReferenceUrl: stringValue(data.characterVoiceReferenceUrl) || undefined,
    characterVoiceFileName: stringValue(data.characterVoiceFileName) || undefined,
    characterVoiceTrimStart: numberValue(data.characterVoiceTrimStart),
    characterVoiceTrimEnd: numberValue(data.characterVoiceTrimEnd),
    characterVoiceDuration: numberValue(data.characterVoiceDuration),
  };
}

export function getCharacterMaterialPrompt(
  material: Pick<MaterialRef, 'slug'> & CharacterMaterialFields,
): string {
  if (!material.characterMaterial) return '';
  return [
    `角色素材 @${material.slug}`,
    material.characterDescription ? `角色描述：${material.characterDescription}` : '',
    material.characterVoiceReferenceUrl ? '已附带该角色裁剪后的参考音色。' : '',
  ].filter(Boolean).join('\n');
}

export type MaterialReferenceKind = 'image' | 'video' | 'audio' | 'unsupported';

export interface ResolvedPromptMaterials {
  cleanPrompt: string;
  references: MaterialRef[];
  referenceUrls: string[];
  referenceImages: string[];
  referenceVideos: string[];
  referenceAudios: string[];
}

/** 为素材节点生成默认 @ 标识（便于提示词匹配） */
export function defaultMaterialSlug(nodeId: string, existing?: string): string {
  if (existing && /^[a-zA-Z0-9_\u4e00-\u9fff-]+$/.test(existing)) return existing;
  const tail = nodeId.replace(/\D/g, '').slice(-4) || '0';
  return `素材${tail}`;
}

export function resolveMaterialFaceComplianceOutput(
  data: Record<string, unknown>,
): { outputUrl: string; inputUrl: string } | null {
  if (data.faceComplianceEnabled !== true || data.faceComplianceProcessed !== true) return null;
  const results = Array.isArray(data.faceComplianceResults)
    ? data.faceComplianceResults as Array<Record<string, unknown>>
    : [];
  const first = results[0];
  const outputUrl = typeof first?.outputUrl === 'string' ? first.outputUrl.trim() : '';
  if (!outputUrl) return null;
  return {
    outputUrl,
    inputUrl: typeof first.inputUrl === 'string' ? first.inputUrl.trim() : '',
  };
}

export function getMaterialNodes(nodes: Node<CanvasNodeData>[]): Node<CanvasNodeData>[] {
  return nodes.filter((n) => n.type === 'material' || n.type === 'storyboard');
}

/** 画布上所有已上传文件的素材，可用于 @ 解析 */
export function getAllMaterialRefs(nodes: Node<CanvasNodeData>[]): MaterialRef[] {
  const out: MaterialRef[] = [];
  for (const n of getMaterialNodes(nodes)) {
    const d = n.data as {
      fileUrl?: string;
      fileName?: string;
      fileType?: string;
      mentionSlug?: string;
      seedanceAssetId?: string;
      seedanceAssetUri?: string;
      seedanceAssetGroupId?: string;
      thumbnailUrl?: string;
      faceComplianceEnabled?: boolean;
      faceComplianceProcessed?: boolean;
      faceComplianceResults?: Array<Record<string, unknown>>;
    };
    const seedanceAssetUri =
      d.seedanceAssetUri || (d.seedanceAssetId ? `asset://${d.seedanceAssetId}` : '');
    const characterFields = getCharacterMaterialFields(d as Record<string, unknown>);
    const hasCharacterContext = Boolean(
      characterFields.characterMaterial &&
      (characterFields.characterDescription || characterFields.characterVoiceReferenceUrl)
    );
    if (!d.fileUrl && !seedanceAssetUri && !hasCharacterContext) continue;
    const compliance = n.type === 'material'
      ? resolveMaterialFaceComplianceOutput(d as Record<string, unknown>)
      : null;
    const slug = d.mentionSlug || defaultMaterialSlug(n.id);
    out.push({
      nodeId: n.id,
      slug,
      fileUrl: compliance?.outputUrl || d.fileUrl || '',
      thumbnailUrl: compliance?.inputUrl || d.thumbnailUrl,
      fileName: d.fileName,
      fileType: d.fileType,
      seedanceAssetId: d.seedanceAssetId,
      seedanceAssetUri,
      seedanceAssetGroupId: d.seedanceAssetGroupId,
      faceCompliance: Boolean(compliance),
      ...characterFields,
    });
  }
  return out;
}

/** 生成节点预览条：直连素材 ∪ 提示词里出现的 @ */
export function getMaterialsForGeneratorPreview(
  consumerId: string,
  prompt: string,
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): MaterialRef[] {
  const connected = getIncomingMaterials(consumerId, nodes, edges);
  const all = getAllMaterialRefs(nodes);
  return getMaterialsForGeneratorPreviewFromRefs(consumerId, prompt, all, edges, connected);
}

export function getMaterialsForGeneratorPreviewFromRefs(
  consumerId: string,
  prompt: string,
  materials: MaterialRef[],
  edges: Edge[],
  connectedOverride?: MaterialRef[]
): MaterialRef[] {
  const connected =
    connectedOverride ||
    edges
      .filter((e) => e.target === consumerId)
      .map((e) => materials.find((m) => m.nodeId === e.source))
      .filter((m): m is MaterialRef => !!m);
  const slugs = new Set(extractMentionSlugs(prompt));
  const mentioned = materials.filter((m) => slugs.has(m.slug));
  const map = new Map<string, MaterialRef>();
  for (const m of [...connected, ...mentioned]) {
    map.set(m.nodeId, m);
  }
  return [...map.values()];
}

/** 画质节点单出点：按下游类型 / 画质「视频」页等自动产出图或视频的素材引用 */
export function topazEdgeToMaterialRef(
  node: Node<CanvasNodeData>,
  edge: Pick<Edge, 'target'>,
  nodes: Node<CanvasNodeData>[]
): MaterialRef | null {
  const d = node.data as Record<string, unknown>;
  const nodeId = node.id;
  const tail = nodeId.replace(/\D/g, '').slice(-4) || '0';
  const slug =
    typeof d.mentionSlug === 'string' && d.mentionSlug.trim().length > 0
      ? String(d.mentionSlug).trim()
      : `画质${tail}`;
  const target = nodes.find((x) => x.id === edge.target);
  const vid = resolveTopazEffectiveVideoUrl(d);
  const img = resolveTopazEffectiveImageUrl(d);
  if (consumerWantsTopazOutboundVideo(target)) {
    if (vid) {
      const poster = img || undefined;
      return {
        nodeId,
        slug,
        fileUrl: vid,
        thumbnailUrl: poster,
        fileName: typeof d.fileName === 'string' && d.fileName.trim() ? d.fileName : `增强视频-${tail}.mp4`,
        fileType: 'video',
      };
    }
    if (img) {
      return {
        nodeId,
        slug,
        fileUrl: img,
        thumbnailUrl: undefined,
        fileName: typeof d.fileName === 'string' && d.fileName.trim() ? d.fileName : `增强图-${tail}.png`,
        fileType: 'image',
      };
    }
    return null;
  }
  if (img) {
    return {
      nodeId,
      slug,
      fileUrl: img,
      thumbnailUrl: undefined,
      fileName: typeof d.fileName === 'string' && d.fileName.trim() ? d.fileName : `增强图-${tail}.png`,
      fileType: 'image',
    };
  }
  if (vid) {
    return {
      nodeId,
      slug,
      fileUrl: vid,
      thumbnailUrl: undefined,
      fileName: typeof d.fileName === 'string' && d.fileName.trim() ? d.fileName : `增强视频-${tail}.mp4`,
      fileType: 'video',
    };
  }
  return null;
}

export function topazNodeToListMaterialRef(nodeId: string, data: CanvasNodeData): MaterialRef | null {
  const d = data as Record<string, unknown>;
  const img = resolveTopazEffectiveImageUrl(d);
  const vid = resolveTopazEffectiveVideoUrl(d);
  const panel = d.topazPanelMode === 'video' ? 'video' : 'image';
  const useVid = panel === 'video' && !!vid;
  const fileUrl = useVid ? vid! : img || vid;
  if (!fileUrl) return null;
  const tail = nodeId.replace(/\D/g, '').slice(-4) || '0';
  const slug =
    typeof data.mentionSlug === 'string' && data.mentionSlug.trim().length > 0
      ? data.mentionSlug.trim()
      : `画质${tail}`;
  return {
    nodeId,
    slug,
    fileUrl,
    thumbnailUrl: useVid ? img || undefined : undefined,
    fileName: useVid ? `增强视频-${tail}.mp4` : `增强图-${tail}.png`,
    fileType: useVid ? 'video' : 'image',
  };
}

function resolveFaceComplianceResult(
  d: Record<string, unknown>,
  index: number,
): { outputUrl: string; faceCount: number } | null {
  const arr = Array.isArray(d.processedResults) ? d.processedResults as Array<Record<string, unknown>> : null;
  if (arr && index < arr.length) {
    const r = arr[index];
    const outputUrl = typeof r.outputUrl === 'string' ? r.outputUrl : '';
    if (outputUrl) return { outputUrl, faceCount: typeof r.faceCount === 'number' ? r.faceCount : 0 };
  }
  // fallback: first result / legacy flat field
  if (index === 0) {
    const url = typeof d.outputImageUrl === 'string' ? d.outputImageUrl : '';
    if (url) return { outputUrl: url, faceCount: typeof d.faceCount === 'number' ? d.faceCount : 0 };
  }
  return null;
}

export function faceComplianceEdgeToMaterialRef(
  node: Node<CanvasNodeData>,
  edge: Pick<Edge, 'sourceHandle'>,
): MaterialRef | null {
  const d = node.data as Record<string, unknown>;
  const tail = node.id.replace(/\D/g, '').slice(-4) || '0';

  let index = 0;
  const handle = edge.sourceHandle;
  if (handle) {
    const m = handle.match(/^result-(\d+)$/);
    if (m) index = parseInt(m[1], 10);
  }

  const r = resolveFaceComplianceResult(d, index);
  if (!r) return null;

  return {
    nodeId: node.id,
    slug: typeof node.data.mentionSlug === 'string' ? node.data.mentionSlug : `合规${tail}-${index + 1}`,
    fileUrl: r.outputUrl,
    fileType: 'image',
    faceCompliance: true,
  };
}

/** 指向 targetId 的素材边：素材 / 分镜 / 画质 等 → 目标节点 */
export function getIncomingMaterials(
  targetId: string,
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): MaterialRef[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: MaterialRef[] = [];
  const seen = new Set<string>();

  for (const e of edges) {
    if (e.target !== targetId) continue;
    const n = byId.get(e.source);
    if (!n?.data) continue;

    let m: MaterialRef | null = null;
    if (n.type === 'topazEnhance') {
      m = topazEdgeToMaterialRef(n, e, nodes);
    } else if (n.type === 'faceCompliance') {
      const fcData = n.data as Record<string, unknown>;
      const arr = Array.isArray(fcData.processedResults) ? fcData.processedResults as Array<Record<string, unknown>> : null;
      const tail = n.id.replace(/\D/g, '').slice(-4) || '0';
      if (arr && arr.length > 0) {
        for (let ri = 0; ri < arr.length; ri++) {
          const r = arr[ri];
          const url = typeof r.outputUrl === 'string' ? r.outputUrl : '';
          if (!url) continue;
          const thumb = typeof r.inputUrl === 'string' ? r.inputUrl : '';
          const key = `${n.id}|r${ri}`;
          if (seen.has(key)) continue;
          seen.add(key);
            out.push({
              nodeId: n.id,
              slug: typeof n.data.mentionSlug === 'string' ? n.data.mentionSlug : `合规${tail}-${ri + 1}`,
              fileUrl: url,
              thumbnailUrl: thumb || undefined,
              fileType: 'image',
              faceCompliance: true,
            });
        }
      } else {
        const legacyUrl = typeof fcData.outputImageUrl === 'string' ? fcData.outputImageUrl : '';
        if (legacyUrl) {
          const key = `${n.id}|legacy`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              nodeId: n.id,
              slug: typeof n.data.mentionSlug === 'string' ? n.data.mentionSlug : `合规${tail}`,
              fileUrl: legacyUrl,
              thumbnailUrl: typeof fcData.inputImageUrl === 'string' ? fcData.inputImageUrl : undefined,
              fileType: 'image',
              faceCompliance: true,
            });
          }
        }
      }
      continue;
    } else if (n.type === 'material' || n.type === 'storyboard') {
      const d = n.data as {
        fileUrl?: string;
        fileName?: string;
        fileType?: string;
        mentionSlug?: string;
        seedanceAssetId?: string;
        seedanceAssetUri?: string;
        seedanceAssetGroupId?: string;
        thumbnailUrl?: string;
        faceComplianceEnabled?: boolean;
        faceComplianceProcessed?: boolean;
        faceComplianceResults?: Array<Record<string, unknown>>;
      };
      const slug = d.mentionSlug || defaultMaterialSlug(n.id, d.mentionSlug);
      const seedanceAssetUri =
        n.type === 'material'
          ? d.seedanceAssetUri || (d.seedanceAssetId ? `asset://${d.seedanceAssetId}` : '')
          : '';
      const compliance = n.type === 'material'
        ? resolveMaterialFaceComplianceOutput(d as Record<string, unknown>)
        : null;
      m = {
        nodeId: n.id,
        slug,
        fileUrl: compliance?.outputUrl || d.fileUrl || '',
        thumbnailUrl: compliance?.inputUrl || d.thumbnailUrl,
        fileName: d.fileName,
        fileType: d.fileType,
        seedanceAssetId: d.seedanceAssetId,
        seedanceAssetUri,
        seedanceAssetGroupId: d.seedanceAssetGroupId,
        faceCompliance: Boolean(compliance),
        ...getCharacterMaterialFields(d as Record<string, unknown>),
      };
      if (
        !m.fileUrl &&
        !m.seedanceAssetUri &&
        !(m.characterMaterial && (m.characterDescription || m.characterVoiceReferenceUrl))
      ) {
        m = null;
      }
    }

    if (!m) continue;
    const dedupKey = m.nodeId + (e.sourceHandle ? `|${e.sourceHandle}` : '');
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push(m);
  }

  return out;
}

const MENTION_RE = /@([a-zA-Z0-9_\u4e00-\u9fff\-.:]+)|\[@?([a-zA-Z0-9_\u4e00-\u9fff\-.:]+)\]/g;

export function getMaterialReferenceUrl(material: MaterialRef): string {
  return material.faceCompliance
    ? material.fileUrl
    : material.seedanceAssetUri || material.fileUrl;
}

export function getMaterialReferenceKind(material: MaterialRef): MaterialReferenceKind {
  const fileType = (material.fileType || '').toLowerCase();
  const url = getMaterialReferenceUrl(material);
  const urlLower = url.toLowerCase();

  if (urlLower.startsWith('asset://') && !fileType) {
    return 'image';
  }

  if (
    fileType === 'video' ||
    urlLower.startsWith('data:video/') ||
    /\.(mp4|mov)(?:[?#].*)?$/i.test(url)
  ) {
    return 'video';
  }

  if (
    fileType === 'audio' ||
    urlLower.startsWith('data:audio/') ||
    /\.(mp3|wav)(?:[?#].*)?$/i.test(url)
  ) {
    return 'audio';
  }

  if (
    fileType === 'image' ||
    urlLower.startsWith('data:image/') ||
    /\.(jpe?g|png|webp|bmp|tiff?|gif)(?:[?#].*)?$/i.test(url)
  ) {
    return 'image';
  }

  return 'unsupported';
}

export function extractMentionSlugs(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const slug = m[1] || m[2];
    if (slug) {
      out.push(slug);
    }
  }
  return out;
}

export function stripMaterialMentionTokens(
  text: string,
  allowedSlugs?: Iterable<string>
): string {
  const allowed = allowedSlugs ? new Set(allowedSlugs) : null;
  return text.replace(
    MENTION_RE,
    (match, plainSlug: string | undefined, bracketSlug: string | undefined) => {
      const slug = plainSlug || bracketSlug || '';
      return allowed?.has(slug) ? match : '';
    }
  );
}

/** 从提示词解析 @slug，返回去标签后的文案与按顺序匹配的素材 URL（仅匹配当前可用列表） */
export function resolvePromptMaterials(
  prompt: string,
  materials: MaterialRef[]
): ResolvedPromptMaterials {
  const bySlug = new Map(materials.map((m) => [m.slug, m]));
  const references: MaterialRef[] = [];

  for (const slug of extractMentionSlugs(prompt)) {
    const material = bySlug.get(slug);
    if (material) {
      references.push(material);
    }
  }

  const cleanPrompt = prompt
    .replace(
      MENTION_RE,
      (match, plainSlug: string | undefined, bracketSlug: string | undefined) => {
        const slug = plainSlug || bracketSlug || '';
        return bySlug.has(slug) ? ' ' : match;
      }
    )
    .replace(/\s+/g, ' ')
    .trim();

  const referenceImages: string[] = [];
  const referenceVideos: string[] = [];
  const referenceAudios: string[] = [];

  for (const material of references) {
    const kind = getMaterialReferenceKind(material);
    const referenceUrl = getMaterialReferenceUrl(material);
    if (kind === 'image') {
      referenceImages.push(referenceUrl);
    } else if (kind === 'video') {
      referenceVideos.push(referenceUrl);
    } else if (kind === 'audio') {
      referenceAudios.push(referenceUrl);
    }
    const characterVoiceUrl = material.characterVoiceReferenceUrl?.trim();
    if (material.characterMaterial && characterVoiceUrl) {
      referenceAudios.push(characterVoiceUrl);
    }
  }

  return {
    cleanPrompt,
    references,
    referenceUrls: references.map(getMaterialReferenceUrl),
    referenceImages,
    referenceVideos,
    referenceAudios,
  };
}

export function resolvePromptMentions(
  prompt: string,
  materials: MaterialRef[]
): { cleanPrompt: string; referenceUrls: string[] } {
  const { cleanPrompt, referenceUrls } = resolvePromptMaterials(prompt, materials);
  return { cleanPrompt, referenceUrls };
}
