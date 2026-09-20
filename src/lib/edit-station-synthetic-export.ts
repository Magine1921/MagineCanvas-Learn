import { inboundToEditClip } from '@/lib/edit-timeline-engine';
import { clipEffectiveDurationMs } from '@/lib/edit-timeline-utils';
import type { EditClip, InboundEditClipCandidate } from '@/lib/edit-timeline-types';

/** Maginecancas 内无 Magine 时间线数据时，按素材池顺序生成线性片段供工程导出（轻量占位）。 */
export function syntheticClipsFromInbound(inbound: InboundEditClipCandidate[]): EditClip[] {
  let t = 0;
  const out: EditClip[] = [];
  for (const c of inbound) {
    const clip = inboundToEditClip(c, t);
    out.push(clip);
    t += clipEffectiveDurationMs(clip);
  }
  return out;
}
