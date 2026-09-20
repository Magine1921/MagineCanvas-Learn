import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EditClip } from '@/lib/edit-timeline-types';
import type { EditTimelineIR } from '@/lib/edit-timeline-ir';
import { clipTimelineFrames, getMaterialForClip } from '@/lib/edit-timeline-ir';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function buildClipItemXml(
  ir: EditTimelineIR,
  clip: EditClip,
  fps: number,
  sourceId: string,
  kind: 'video' | 'audio',
  mediaRoot?: string,
): string {
  const mat = getMaterialForClip(ir, clip.id);
  if (!mat) return '';
  const { startFrame, durationFrames, inFrame, outFrame } = clipTimelineFrames(clip, fps);
  const pathUrl = mediaRoot
    ? pathToFileURL(path.resolve(mediaRoot, mat.relativePath)).href
    : `file://localhost/${mat.relativePath.replace(/\\/g, '/')}`;
  const name = xmlEscape(clip.fileName || mat.fileName || `clip_${sourceId}`);
  const videoClipItemId = `clipitem-${sourceId}-v`;
  const audioClipItemId = `clipitem-${sourceId}-a`;
  const clipItemId = kind === 'video' ? videoClipItemId : audioClipItemId;
  const fileId = `file-${sourceId}`;
  const hasVideo = clip.mediaKind !== 'audio';
  const hasAudio = clip.mediaKind === 'video' || clip.mediaKind === 'audio';
  const fileMedia = `${hasVideo ? `                <video>
                  <samplecharacteristics>
                    <width>${ir.sequence.width}</width>
                    <height>${ir.sequence.height}</height>
                  </samplecharacteristics>
                </video>` : ''}${hasAudio ? `
                <audio>
                  <samplecharacteristics>
                    <samplerate>48000</samplerate>
                    <depth>16</depth>
                  </samplecharacteristics>
                  <layout>stereo</layout>
                  <channelcount>2</channelcount>
                </audio>` : ''}`;
  const reusesVideoFile = kind === 'audio' && clip.mediaKind === 'video';
  const fileXml = reusesVideoFile
    ? `            <file id="${fileId}"/>`
    : `            <file id="${fileId}">
              <name>${xmlEscape(mat.fileName)}</name>
              <pathurl>${xmlEscape(pathUrl)}</pathurl>
              <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
              </rate>
              <duration>${Math.max(durationFrames, outFrame)}</duration>
              <media>
${fileMedia}
              </media>
            </file>`;
  const linkXml = clip.mediaKind === 'video'
    ? `
            <link>
              <linkclipref>${videoClipItemId}</linkclipref>
            </link>
            <link>
              <linkclipref>${audioClipItemId}</linkclipref>
              <groupindex>1</groupindex>
            </link>`
    : '';

  return `
          <clipitem id="${clipItemId}">
            <name>${name}</name>
            <duration>${durationFrames}</duration>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <start>${startFrame}</start>
            <end>${startFrame + durationFrames}</end>
            <in>${inFrame}</in>
            <out>${outFrame}</out>
${fileXml}
            <sourcetrack>
              <mediatype>${kind}</mediatype>
              <trackindex>1</trackindex>
            </sourcetrack>${linkXml}
          </clipitem>`;
}

function buildTrackXml(
  ir: EditTimelineIR,
  clips: EditClip[],
  fps: number,
  kind: 'video' | 'audio',
  sourceIds: Map<string, string>,
  mediaRoot?: string,
): string {
  const clipItems = clips
    .map((clip) =>
      buildClipItemXml(
        ir,
        clip,
        fps,
        sourceIds.get(clip.id) || clip.id,
        kind,
        mediaRoot,
      )
    )
    .join('\n');
  return `
        <track>
${clipItems}
        </track>`;
}

export function buildFcp7Xmeml(
  ir: EditTimelineIR,
  sequenceName = 'MagineCanvas Edit',
  mediaRoot?: string,
): string {
  const { sequence, clips, totalFrames } = ir;
  const fps = sequence.fps;
  const visualTracks = groupClipsByTrack(clips.filter((c) => c.mediaKind !== 'audio'));
  const embeddedAudioTracks = groupClipsByTrack(clips.filter((c) => c.mediaKind === 'video'));
  const standaloneAudioTracks = groupClipsByTrack(clips.filter((c) => c.mediaKind === 'audio'));
  const audioTracks = [...embeddedAudioTracks, ...standaloneAudioTracks];
  const sourceIds = new Map(clips.map((clip, index) => [clip.id, String(index + 1)]));
  const videoXml =
    visualTracks
      .map((track) => buildTrackXml(ir, track, fps, 'video', sourceIds, mediaRoot))
      .join('\n') ||
    '        <track />';
  const audioXml = audioTracks
    .map((track) => buildTrackXml(ir, track, fps, 'audio', sourceIds, mediaRoot))
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${xmlEscape(sequenceName)}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${sequence.width}</width>
            <height>${sequence.height}</height>
            <pixelaspectratio>square</pixelaspectratio>
          </samplecharacteristics>
        </format>
${videoXml}
      </video>${audioXml ? `
      <audio>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <outputs>
          <group>
            <index>1</index>
            <numchannels>2</numchannels>
            <downmix>4</downmix>
            <channel><index>1</index></channel>
            <channel><index>2</index></channel>
          </group>
        </outputs>
${audioXml}
      </audio>` : ''}
    </media>
  </sequence>
</xmeml>`;
}

