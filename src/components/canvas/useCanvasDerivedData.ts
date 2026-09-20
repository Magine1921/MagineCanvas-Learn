'use client';

import { useMemo } from 'react';
import type { Edge, Node } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { useCanvasStore, type CanvasNodeData } from './CanvasStore';
import {
  defaultMaterialSlug,
  resolveMaterialFaceComplianceOutput,
  topazEdgeToMaterialRef,
  topazNodeToListMaterialRef,
  type MaterialRef,
} from '@/lib/material-mentions';
import { getPromptTextForEdgeSource, type PromptSource } from '@/lib/prompt-flow';
import { resolveConnectedMaterialMedia } from '@/lib/connected-material-media';

type NodePart = string | CanvasNodeData | undefined;

export function useCanvasEdges() {
  return useCanvasStore((state) => state.edges);
}

export function useMaterialRefs(): MaterialRef[] {
  const materialParts = useCanvasStore(
    useShallow((state) => {
      const parts: NodePart[] = [];
      for (const node of state.nodes) {
        if (
          node.type !== 'material' &&
          node.type !== 'image' &&
          node.type !== 'storyboard' &&
          node.type !== 'video' &&
          node.type !== 'music' &&
          node.type !== 'topazEnhance' &&
          node.type !== 'faceCompliance' &&
          node.type !== 'browser'
        ) {
          continue;
        }
        parts.push(node.id, node.type, node.data);
      }
      return parts;
    })
  );

  return useMemo(() => {
    const refs: MaterialRef[] = [];

    for (let index = 0; index < materialParts.length; index += 3) {
      const nodeId = materialParts[index] as string;
      const nodeType = materialParts[index + 1] as CanvasNodeData['type'];
      const data = materialParts[index + 2] as CanvasNodeData;

      if (nodeType === 'music') {
        const d = data as Record<string, unknown>;
        const isTts = d.mode === 'tts';
        let audioUrl = typeof (isTts ? d.ttsAudioUrl : d.audioUrl) === 'string'
          ? String(isTts ? d.ttsAudioUrl : d.audioUrl).trim()
          : '';
        const history = isTts ? d.generatedTTS : d.generatedMusic;
        if (!audioUrl && Array.isArray(history)) {
          const latest = history.find((item) => {
            if (!item || typeof item !== 'object') return false;
            return typeof (item as Record<string, unknown>).audioUrl === 'string';
          }) as Record<string, unknown> | undefined;
          audioUrl = typeof latest?.audioUrl === 'string' ? latest.audioUrl.trim() : '';
        }
        if (!audioUrl) continue;
        const tail = nodeId.replace(/\D/g, '').slice(-4) || '0';
        refs.push({
          nodeId,
          slug: typeof data.mentionSlug === 'string' ? data.mentionSlug : `${isTts ? '语音' : '音乐'}${tail}`,
          fileUrl: audioUrl,
          fileName: `${isTts ? '语音' : '音乐'}${tail}.mp3`,
          fileType: 'audio/mpeg',
        });
        continue;
      }

      if (nodeType === 'video') {
        const d = data as Record<string, unknown>;
        let vUrl = typeof d.videoUrl === 'string' ? d.videoUrl.trim() : '';
        if (!vUrl && Array.isArray(d.generatedVideos)) {
          let best = '';
          let bestAt = -1;
          for (const it of d.generatedVideos as unknown[]) {
            if (!it || typeof it !== 'object') continue;
            const o = it as Record<string, unknown>;
            const u = typeof o.videoUrl === 'string' ? (o.videoUrl as string).trim() : '';
            const ca = typeof o.createdAt === 'number' ? (o.createdAt as number) : 0;
            if (u && ca >= bestAt) {
              best = u;
              bestAt = ca;
            }
          }
          vUrl = best;
        }
        if (!vUrl) continue;
        const tail = nodeId.replace(/\D/g, '').slice(-4) || '0';
        const poster =
          typeof d.posterUrl === 'string'
            ? (d.posterUrl as string)
            : typeof d.thumbnailUrl === 'string'
              ? (d.thumbnailUrl as string)
              : undefined;
        refs.push({
          nodeId,
          slug: typeof data.mentionSlug === 'string' ? data.mentionSlug : `视频${tail}`,
          fileUrl: vUrl,
          thumbnailUrl: poster,
          fileName: typeof d.fileName === 'string' ? (d.fileName as string) : `视频${tail}.mp4`,
          fileType: 'video/mp4',
        });
        continue;
      }

      if (nodeType === 'topazEnhance') {
        const ref = topazNodeToListMaterialRef(nodeId, data);
        if (ref) refs.push(ref);
        continue;
      }

      if (nodeType === 'faceCompliance') {
        const d = data as Record<string, unknown>;
        let outputUrl = typeof d.outputImageUrl === 'string' ? d.outputImageUrl : '';
        let inputUrl = typeof d.inputImageUrl === 'string' ? d.inputImageUrl : '';
        if (!outputUrl && Array.isArray(d.processedResults)) {
          const results = d.processedResults as Array<Record<string, unknown>>;
          outputUrl = typeof results[0]?.outputUrl === 'string' ? results[0].outputUrl as string : '';
          inputUrl = typeof results[0]?.inputUrl === 'string' ? results[0].inputUrl as string : '';
        }
        if (!outputUrl) continue;
        const tail = nodeId.replace(/\D/g, '').slice(-4) || '0';
        refs.push({
          nodeId,
          slug: typeof data.mentionSlug === 'string' ? data.mentionSlug : `合规${tail}`,
          fileUrl: outputUrl,
          thumbnailUrl: inputUrl || undefined,
          fileType: 'image',
          faceCompliance: true,
        });
        continue;
      }

      const materialCompliance = nodeType === 'material'
        ? resolveMaterialFaceComplianceOutput(data as Record<string, unknown>)
        : null;
      const fileUrl = materialCompliance?.outputUrl || (
        nodeType === 'image'
          ? typeof data.imageUrl === 'string'
            ? data.imageUrl
            : ''
            : typeof data.fileUrl === 'string'
            ? data.fileUrl
            : ''
      );
      const seedanceAssetId =
        nodeType === 'material' && typeof data.seedanceAssetId === 'string'
          ? data.seedanceAssetId
          : '';
      const seedanceAssetUri =
        (nodeType === 'material' && typeof data.seedanceAssetUri === 'string'
          ? data.seedanceAssetUri
          : '') ||
        (seedanceAssetId ? `asset://${seedanceAssetId}` : '');

      if (!fileUrl && !seedanceAssetUri) continue;

      const fallbackSlug =
        nodeType === 'image'
          ? `生成图${nodeId.replace(/\D/g, '').slice(-4) || '0'}`
          : nodeType === 'storyboard'
            ? `分镜${nodeId.replace(/\D/g, '').slice(-4) || '0'}`
            : defaultMaterialSlug(nodeId);

      refs.push({
        nodeId,
        slug:
          typeof data.mentionSlug === 'string'
            ? data.mentionSlug
            : fallbackSlug,
        fileUrl,
        thumbnailUrl: materialCompliance?.inputUrl || (
          typeof data.thumbnailUrl === 'string'
            ? data.thumbnailUrl
            : undefined
        ),
        fileName:
          typeof data.fileName === 'string'
            ? data.fileName
            : nodeType === 'image'
              ? '图像生成当前图'
              : nodeType === 'storyboard'
                ? '手绘分镜.png'
                : undefined,
        fileType:
          typeof data.fileType === 'string'
            ? data.fileType
            : nodeType === 'image' || nodeType === 'storyboard'
              ? 'image'
              : undefined,
        seedanceAssetId: seedanceAssetId || undefined,
        seedanceAssetUri: seedanceAssetUri || undefined,
        seedanceAssetGroupId:
          typeof data.seedanceAssetGroupId === 'string'
            ? data.seedanceAssetGroupId
            : undefined,
        faceCompliance: Boolean(materialCompliance),
      });
    }

    return refs;
  }, [materialParts]);
}

let indexedNodesRef: Node<CanvasNodeData>[] | null = null;
let nodeByIdCache = new Map<string, Node<CanvasNodeData>>();
let indexedEdgesRef: Edge[] | null = null;
let incomingEdgesByTargetCache = new Map<string, Edge[]>();
let indexedMaterialsRef: MaterialRef[] | null = null;
let materialByNodeIdCache = new Map<string, MaterialRef>();

function getNodeById(nodes: Node<CanvasNodeData>[]): Map<string, Node<CanvasNodeData>> {
  if (nodes !== indexedNodesRef) {
    indexedNodesRef = nodes;
    nodeByIdCache = new Map(nodes.map((node) => [node.id, node]));
  }
  return nodeByIdCache;
}

function getIncomingEdges(edges: Edge[], targetId: string): Edge[] {
  if (edges !== indexedEdgesRef) {
    indexedEdgesRef = edges;
    incomingEdgesByTargetCache = new Map();
    for (const edge of edges) {
      const incoming = incomingEdgesByTargetCache.get(edge.target);
      if (incoming) incoming.push(edge);
      else incomingEdgesByTargetCache.set(edge.target, [edge]);
    }
  }
  return incomingEdgesByTargetCache.get(targetId) || [];
}

function getMaterialByNodeId(materials: MaterialRef[]): Map<string, MaterialRef> {
  if (materials !== indexedMaterialsRef) {
    indexedMaterialsRef = materials;
    materialByNodeIdCache = new Map(materials.map((material) => [material.nodeId, material]));
  }
  return materialByNodeIdCache;
}

export function useIncomingMaterialRefs(targetId: string): MaterialRef[] {
  const edges = useCanvasEdges();
  const materials = useMaterialRefs();
  const nodes = useCanvasStore(useShallow((s) => s.nodes));

  return useMemo(() => {
    const byNodeId = getMaterialByNodeId(materials);
    const nodeById = getNodeById(nodes);
    const seen = new Set<string>();
    const connected: MaterialRef[] = [];

    for (const edge of getIncomingEdges(edges, targetId)) {
      const node = nodeById.get(edge.source);
      if (!node) continue;
      let material: MaterialRef | null = null;
      if (node?.type === 'topazEnhance') {
        const m = topazEdgeToMaterialRef(node as Node<CanvasNodeData>, edge, nodes);
        if (m) {
          const key = m.nodeId + (edge.sourceHandle ? `|${edge.sourceHandle}` : '');
          if (!seen.has(key)) { seen.add(key); connected.push(m); }
        }
        continue;
      }
      if (node?.type === 'faceCompliance') {
        const d = node.data as Record<string, unknown>;
        const arr = Array.isArray(d.processedResults) ? d.processedResults as Array<Record<string, unknown>> : null;
        const tail = node.id.replace(/\D/g, '').slice(-4) || '0';
        if (arr && arr.length > 0) {
          for (let ri = 0; ri < arr.length; ri++) {
            const r = arr[ri];
            const url = typeof r.outputUrl === 'string' ? r.outputUrl : '';
            if (!url) continue;
            const thumb = typeof r.inputUrl === 'string' ? r.inputUrl : '';
            const key = `${node.id}|r${ri}`;
            if (seen.has(key)) continue;
            seen.add(key);
            connected.push({
              nodeId: node.id,
              slug: typeof node.data.mentionSlug === 'string' ? node.data.mentionSlug : `合规${tail}-${ri + 1}`,
              fileUrl: url,
              thumbnailUrl: thumb || undefined,
              fileType: 'image',
              faceCompliance: true,
            });
          }
        } else {
          const legacyUrl = typeof d.outputImageUrl === 'string' ? d.outputImageUrl : '';
          if (legacyUrl) {
            const key = `${node.id}|legacy`;
            if (!seen.has(key)) {
              seen.add(key);
              connected.push({
                nodeId: node.id,
                slug: typeof node.data.mentionSlug === 'string' ? node.data.mentionSlug : `合规${tail}`,
                fileUrl: legacyUrl,
                thumbnailUrl: typeof d.inputImageUrl === 'string' ? d.inputImageUrl : undefined,
                fileType: 'image',
                faceCompliance: true,
              });
            }
          }
        }
        continue;
      }
      // 素材节点的人脸合规处理
      if (node?.type === 'material') {
        const d = node.data as Record<string, unknown>;
        const fcEnabled = d.faceComplianceEnabled === true;
        const fcProcessed = d.faceComplianceProcessed === true;
        const fcResults = Array.isArray(d.faceComplianceResults) ? d.faceComplianceResults as Array<Record<string, unknown>> : null;
        
        // 如果启用了人脸合规且处理完成，输出处理后的图片
        if (fcEnabled && fcProcessed && fcResults && fcResults.length > 0) {
          const r = fcResults[0];
          const url = typeof r.outputUrl === 'string' ? r.outputUrl : '';
          if (url) {
            const key = `${node.id}|fc`;
            if (!seen.has(key)) {
              seen.add(key);
              connected.push({
                nodeId: node.id,
                slug: typeof d.mentionSlug === 'string' ? d.mentionSlug as string : node.data.label || '素材',
                fileUrl: url,
                thumbnailUrl: typeof r.inputUrl === 'string' ? r.inputUrl as string : undefined,
                fileType: 'image',
                faceCompliance: true,
              });
            }
          }
          continue;
        }
      }
      material = byNodeId.get(edge.source) ?? null;
      if (!material) continue;
      const dedupKey = material.nodeId + (edge.sourceHandle ? `|${edge.sourceHandle}` : '');
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      connected.push(material);
    }

    return connected;
  }, [edges, materials, nodes, targetId]);
}

export function useIncomingPromptSources(targetId: string): PromptSource[] {
  const edges = useCanvasEdges();
  const nodes = useCanvasStore(useShallow((s) => s.nodes));

  return useMemo(() => {
    const nodeById = getNodeById(nodes);
    return getIncomingEdges(edges, targetId)
      .map((edge) => {
        const node = nodeById.get(edge.source);
        if (!node || node.type === 'material' || node.type === 'storyboard' || node.type === 'panorama') {
          return null;
        }
        const text = getPromptTextForEdgeSource(node as Node<CanvasNodeData>, edge.sourceHandle ?? null);
        if (!text) return null;
        return {
          nodeId: edge.source,
          nodeType: (node.data as CanvasNodeData).type,
          label: typeof node.data.label === 'string' ? node.data.label : '上游节点',
          text,
        };
      })
      .filter((source): source is PromptSource => !!source);
  }, [edges, nodes, targetId]);
}

export function useIncomingDisplayMedia(targetId: string) {
  const edges = useCanvasEdges();
  const nodes = useCanvasStore(useShallow((state) => state.nodes));
  return useMemo(
    () => resolveConnectedMaterialMedia(targetId, nodes, edges),
    [edges, nodes, targetId],
  );
}
