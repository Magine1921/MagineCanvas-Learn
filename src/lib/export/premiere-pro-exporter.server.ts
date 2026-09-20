import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { EditTimelineIR } from '@/lib/edit-timeline-ir';
import { clipTimelineFrames, getMaterialForClip } from '@/lib/edit-timeline-ir';

function uuid(): string {
  return crypto.randomUUID();
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the .prproj XML string from an EditTimelineIR. */
export function buildPremiereProXml(ir: EditTimelineIR): string {
  const { sequence, clips, totalFrames } = ir;
  const fps = sequence.fps;
  const videoFpsNumerator = fps * 254016000; // Premiere internal tick rate
  const audioFpsNumerator = 48000 * 254016; // Audio tick rate

  // Object ID counter
  let nextId = 100;

  // Track clip lists
  const trackMap = new Map<number, typeof clips>();
  for (const clip of clips) {
    const list = trackMap.get(clip.trackIndex) || [];
    list.push(clip);
    trackMap.set(clip.trackIndex, list);
  }
  const videoTracks = [...trackMap.entries()]
    .filter(([, tClips]) => tClips.every((c) => c.mediaKind !== 'audio'))
    .sort((a, b) => a[0] - b[0]);
  const audioTracks = [...trackMap.entries()]
    .filter(([, tClips]) => tClips.every((c) => c.mediaKind === 'audio'))
    .sort((a, b) => a[0] - b[0]);

  const parts: string[] = [];

  // --- PremiereData header ---
  parts.push('<?xml version="1.0" encoding="UTF-8" ?>');
  parts.push('<PremiereData Version="3">');
  parts.push('<Project ObjectRef="1"/>');

  // --- Project root ---
  const projectVersion = '43'; // CC 2025
  parts.push(
    `<Project ObjectID="1" ClassID="62ad66dd-0dcd-42da-a660-6d8fbde94876" Version="${projectVersion}">`
  );
  parts.push('<Node Version="1"><Properties Version="1">');

  // --- ProjectViewState.List (minimal) ---
  parts.push(
    '<ProjectViewState.List ObjectID="2" ClassID="aab0946f-7a21-4425-8908-fafa2119e30e" Version="3">'
  );
  parts.push('<ProjectViewStates Version="1">');
  parts.push(
    '<ProjectViewState Version="1" Index="0"><First>19962e45-9824-4298-bd51-965765530780</First><Second ObjectRef="1"/></ProjectViewState>'
  );
  parts.push('</ProjectViewStates>');
  // Minimal view state
  const vsId = nextId++;
  parts.push(
    `<ProjectViewState ObjectID="${vsId}" ClassID="18fb911d-4f21-4b7b-b196-b250dad79838" Version="3">`
  );
  parts.push(`<Columns.List ObjectRef="${nextId}"/>`);
  parts.push('<ProjectViewState.ID>19962e45-9824-4298-bd51-965765530780</ProjectViewState.ID>');
  parts.push('<ProjectViewState.OriginalID>00000000-0000-0000-0000-000000000000</ProjectViewState.OriginalID>');
  parts.push('<ProjectViewState.BinID>-1</ProjectViewState.BinID>');
  parts.push('<ProjectViewState.ViewHidden>false</ProjectViewState.ViewHidden>');
  parts.push('<PreviewView.Visible>false</PreviewView.Visible>');
  parts.push('<ContentView.LastViewed>1</ContentView.LastViewed>');
  parts.push('<IconView.Thumbnail.Size>200</IconView.Thumbnail.Size>');
  parts.push('<FreeformView.Scale>1</FreeformView.Scale>');
  parts.push('<ListView.Thumbnail.Size>0</ListView.Thumbnail.Size>');
  parts.push('<IconView.Thumbnail.State>true</IconView.Thumbnail.State>');
  parts.push('<ListView.Thumbnail.State>false</ListView.Thumbnail.State>');
  parts.push('<Thumbnail.ShowsEffects.State>true</Thumbnail.ShowsEffects.State>');
  parts.push('<Sort.Enabled>true</Sort.Enabled>');
  parts.push('<Sort.Type>0</Sort.Type>');
  parts.push('<Sort.Direction>0</Sort.Direction>');
  parts.push('<Sort.ColumnIndex>2</Sort.ColumnIndex>');
  parts.push('<ColumnListContents.Version>13</ColumnListContents.Version>');
  parts.push('<ListView.NameColumnWidth>0</ListView.NameColumnWidth>');
  parts.push('<IconSort.Type>0</IconSort.Type>');
  parts.push('<IconSort.Direction>0</IconSort.Direction>');
  parts.push('<IconSort.ColumnIndex>0</IconSort.ColumnIndex>');
  parts.push('<IconFilter.FilterType>0</IconFilter.FilterType>');
  parts.push('</ProjectViewState>');
  parts.push('</ProjectViewState.List>');

  // --- ColumnList ---
  const clId = nextId++;
  parts.push(`<ColumnList ObjectID="${clId}" ClassID="a1c709cd-35df-4821-8200-03565d374155" Version="1">`);
  parts.push('<Columns Version="1">');
  const colNames = ['Name', 'Label', 'Media Type', 'Frame Rate', 'Media Start', 'Media End', 'Media Duration', 'Video In Point', 'Video Out Point', 'Video Duration', 'Audio In Point', 'Audio Out Point', 'Audio Duration', 'Tape Name', 'Description', 'Comment', 'Log Note', 'File Path', 'Capture Settings', 'Status', 'Offline Properties', 'Scene', 'Shot', 'Good'];
  colNames.forEach((name, idx) => {
    parts.push(
      `<Column Index="${idx}" ObjectRef="${nextId++}"/>`
    );
  });
  parts.push('</Columns>');
  // Individual Column objects
  colNames.forEach((name, idx) => {
    const cid = vsId + 1 + idx;
    parts.push(
      `<Column ObjectID="${cid}" ClassID="a1c709cd-35df-4821-8200-03565d374156" Version="1">`
    );
    parts.push(`<Name>${xmlEscape(name)}</Name>`);
    parts.push('<Width>120</Width>');
    parts.push('<IsVisible>true</IsVisible>');
    parts.push('</Column>');
  });
  nextId = vsId + 1 + colNames.length;
  parts.push('</ColumnList>');

  // --- Project metadata ---
  parts.push('<MZ.PrefixKey.OpenSequenceGuidList.1>90b9a44d-f408-4616-b5d0-d48bf905137a</MZ.PrefixKey.OpenSequenceGuidList.1>');
  parts.push('<MZ.Prefs.UseProjectItemOrMasterClipProperiesForTrackItems>false</MZ.Prefs.UseProjectItemOrMasterClipProperiesForTrackItems>');
  parts.push('</Properties></Node>');
  parts.push('<NextSequenceID>2</NextSequenceID>');

  // --- Root Bin ---
  const binId = nextId++;
  parts.push(`<Bin ObjectID="${binId}" ClassID="68699ca1-6d27-4c7d-b316-0b7ab5b24bfc" Version="1">`);
  parts.push('<Node Version="1"><Properties Version="1">');
  parts.push('<Name>Root Bin</Name>');
  parts.push('</Properties></Node>');
  parts.push('<Children Version="1">');
  parts.push('__MASTERCLIP_BIN_REFS__');
  parts.push('</Children>');
  parts.push('</Bin>');

  // --- DefaultSequenceSettings ---
  const dssId = nextId++;
  parts.push(`<DefaultSequenceSettings ObjectID="${dssId}" ClassID="567bdf53-d6d9-4d61-b2f1-f4834bebea9b" Version="2">`);
  parts.push('<SequenceSettings Version="2">');
  parts.push(`<FrameSizeHorizontal>${sequence.width}</FrameSizeHorizontal>`);
  parts.push(`<FrameSizeVertical>${sequence.height}</FrameSizeVertical>`);
  parts.push(`<VideoFrameRate>${videoFpsNumerator}</VideoFrameRate>`);
  parts.push('<PixelAspectRatio>1,1</PixelAspectRatio>');
  parts.push('<FieldType>0</FieldType>');
  parts.push('</SequenceSettings>');
  parts.push('</DefaultSequenceSettings>');
  parts.push('</Project>');

  // --- Media + MasterClip objects ---
  const clipToMasterClipUid = new Map<string, string>();
  const masterClipBinRefs: string[] = [];

  for (let i = 0; i < ir.materials.length; i++) {
    const mat = ir.materials[i];
    const clip = clips.find((c) => c.id === mat.clipId);
    const mediaUid = uuid();
    const mediaOid = nextId++;

    const isImage = mat.mediaKind === 'image';
    const isAudio = mat.mediaKind === 'audio';
    const durFrames = clip
      ? clipTimelineFrames(clip, fps).durationFrames
      : Math.round((ir.totalDurationMs / 1000) * fps);
    const durationTicks = durFrames * (videoFpsNumerator / fps);

    parts.push(
      `<Media ObjectUID="${mediaUid}" ClassID="7a5c103e-f3ac-4391-b6b4-7cc3d2f9a7ff" Version="27">`
    );

    if (isAudio || (!isImage && !isAudio)) {
      // Audio stream
      const asId = nextId++;
      parts.push(`<AudioStream ObjectRef="${asId}"/>`);
    }
    if (!isAudio) {
      // Video stream
      const vsId = nextId++;
      parts.push(`<VideoStream ObjectRef="${vsId}"/>`);
    }

    parts.push(
      `<ModificationState Encoding="base64" BinaryHash="${uuid()}">AAAAAA==</ModificationState>`
    );
    parts.push(`<RelativePath>${xmlEscape(mat.relativePath)}</RelativePath>`);
    parts.push(`<FilePath>${xmlEscape(mat.relativePath)}</FilePath>`);
    parts.push('<ImplementationID>1fa18bfa-255c-44b1-ad73-56bcd99fceaf</ImplementationID>');
    parts.push(`<Title>${xmlEscape(clip?.fileName || mat.fileName)}</Title>`);
    parts.push(`<FileKey>${uuid()}</FileKey>`);
    parts.push(`<ActualMediaFilePath>${xmlEscape(mat.relativePath)}</ActualMediaFilePath>`);
    if (isImage) {
      parts.push('<TimeDisplay>110</TimeDisplay>');
    }
    parts.push(`<ContentAndMetadataState>${uuid()}</ContentAndMetadataState>`);
    if (!isImage) {
      parts.push(`<ConformedAudioRate>48000</ConformedAudioRate>`);
    }
    parts.push('</Media>');

    // VideoStream
    if (!isAudio) {
      const vsId = nextId++;
      parts.push(
        `<VideoStream ObjectID="${vsId}" ClassID="a36e4719-3ec6-4a0c-ab11-8b4aab377aa5" Version="19">`
      );
      if (isImage) {
        parts.push('<IsStill>true</IsStill>');
        parts.push('<IsContinuousTime>true</IsContinuousTime>');
      }
      parts.push('<SelectedColorSpace>{}</SelectedColorSpace>');
      parts.push('<OverriddenColorSpace>{}</OverriddenColorSpace>');
      parts.push('<InputLUTSpecified>false</InputLUTSpecified>');
      parts.push('<InputLUTID>00000000-0000-0000-0000-000000000000</InputLUTID>');
      if (!isImage) {
        parts.push('<IgnoreAlpha>true</IgnoreAlpha>');
      }
      parts.push(`<FrameRate>${videoFpsNumerator}</FrameRate>`);
      parts.push(`<FrameRect>0,0,${sequence.width},${sequence.height}</FrameRect>`);
      parts.push(`<Duration>${durationTicks}</Duration>`);
      if (isImage) {
        parts.push('<CodecType>1380013856</CodecType>');
        parts.push('<FieldTypeIsUncertain>true</FieldTypeIsUncertain>');
      } else {
        parts.push('<CodecType>1096172337</CodecType>');
        parts.push('<OriginalImageOrientationType>1</OriginalImageOrientationType>');
      }
      parts.push('</VideoStream>');
    }

    // AudioStream
    if (isAudio || (!isImage && !isAudio)) {
      const asId = nextId++;
      parts.push(
        `<AudioStream ObjectID="${asId}" ClassID="0b5cf52f-2b85-4863-890b-8844b64ecfe9" Version="7">`
      );
      parts.push('<FrameRate>48000</FrameRate>');
      parts.push(`<ConformedAudioPath>${xmlEscape(mat.relativePath + '.pek')}</ConformedAudioPath>`);
      parts.push(`<PeakFilePath>${xmlEscape(mat.relativePath + '.pek')}</PeakFilePath>`);
      parts.push('<SampleType>7</SampleType>');
      parts.push(`<Duration>${Math.round(durationTicks * 48000 / videoFpsNumerator)}</Duration>`);
      parts.push('<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>');
      parts.push('</AudioStream>');
    }

    // ClipChannelSerializers
    const ch1Id = nextId++;
    const ch2Id = nextId++;
    parts.push(`<ClipChannelSerializer ObjectID="${ch1Id}" ClassID="5c89aa7a-89a6-4483-becd-f2b1def42316" Version="1">`);
    parts.push('<SourceClipIndex>0</SourceClipIndex>');
    parts.push('<mSourceChannelIndex>0</mSourceChannelIndex>');
    parts.push('</ClipChannelSerializer>');
    if (!isImage) {
      parts.push(`<ClipChannelSerializer ObjectID="${ch2Id}" ClassID="5c89aa7a-89a6-4483-becd-f2b1def42316" Version="1">`);
      parts.push('<SourceClipIndex>0</SourceClipIndex>');
      parts.push('<mSourceChannelIndex>1</mSourceChannelIndex>');
      parts.push('</ClipChannelSerializer>');
    }

    // MasterClip
    const mcUid = uuid();
    if (clip) clipToMasterClipUid.set(clip.id, mcUid);
    masterClipBinRefs.push(`<MasterClip ObjectURef="${mcUid}"/>`);
    parts.push(
      `<MasterClip ObjectUID="${mcUid}" ClassID="fb11c33a-b0a9-4465-aa94-b6d5db2628cf" Version="11">`
    );
    parts.push('<Node Version="1"><Properties Version="1">');
    parts.push(`<Name>${xmlEscape(clip?.fileName || mat.fileName)}</Name>`);
    parts.push('</Properties></Node>');
    parts.push(`<Media ObjectURef="${mediaUid}"/>`);
    parts.push('<OriginatingMasterClipID>00000000-0000-0000-0000-000000000000</OriginatingMasterClipID>');
    parts.push('<MasterClipChangeVersion>1</MasterClipChangeVersion>');
    parts.push('</MasterClip>');
  }

  // Insert MasterClip refs into Bin Children
  const binRefsXml = masterClipBinRefs.join('\n');
  for (let p = 0; p < parts.length; p++) {
    if (parts[p] === '__MASTERCLIP_BIN_REFS__') {
      parts[p] = binRefsXml;
      break;
    }
  }

  // --- AudioSequenceSource ---
  const assId = nextId++;
  parts.push(
    `<AudioSequenceSource ObjectID="${assId}" ClassID="e8d4cc83-38cb-491f-9d94-e5f7e3b205ee" Version="7">`
  );
  parts.push('<SequenceSource Version="4">');
  parts.push('<Name>MagineCanvas Edit</Name>');
  parts.push('<Sequence ObjectURef="90b9a44d-f408-4616-b5d0-d48bf905137a"/>');
  parts.push('</SequenceSource>');
  parts.push(`<ClipChannelSerializer ObjectRef="${nextId++}"/>`);
  parts.push('</AudioSequenceSource>');

  // --- VideoSequenceSource ---
  const vssId = nextId++;
  parts.push(
    `<VideoSequenceSource ObjectID="${vssId}" ClassID="4752dfa9-7a7e-4a3b-a25b-cafde1a8d036" Version="3">`
  );
  parts.push('<SequenceSource Version="4">');
  parts.push('<Name>MagineCanvas Edit</Name>');
  parts.push('<Sequence ObjectURef="90b9a44d-f408-4616-b5d0-d48bf905137a"/>');
  parts.push('</SequenceSource>');
  parts.push(`<ClipChannelSerializer ObjectRef="${nextId++}"/>`);
  parts.push('</VideoSequenceSource>');

  // --- Sequence ---
  const seqId = nextId++;
  parts.push(
    '<Sequence ObjectUID="90b9a44d-f408-4616-b5d0-d48bf905137a" ClassID="6a15d903-8739-11d5-af2d-9b7855ad8974" Version="11">'
  );
  parts.push('<Node Version="1"><Properties Version="1">');
  parts.push(`<MZ.Sequence.AudioTimeDisplayFormat>200</MZ.Sequence.AudioTimeDisplayFormat>`);
  parts.push('<MZ.Sequence.EditingModeGUID>795454d9-d3c2-429d-9474-923ab13b7018</MZ.Sequence.EditingModeGUID>');
  parts.push(`<MZ.Sequence.PreviewFrameSizeHeight>${sequence.height}</MZ.Sequence.PreviewFrameSizeHeight>`);
  parts.push(`<MZ.Sequence.PreviewFrameSizeWidth>${sequence.width}</MZ.Sequence.PreviewFrameSizeWidth>`);
  parts.push('<MZ.Sequence.PreviewRenderingClassID>1297106761</MZ.Sequence.PreviewRenderingClassID>');
  parts.push('<MZ.Sequence.PreviewRenderingPresetCodec>1297107278</MZ.Sequence.PreviewRenderingPresetCodec>');
  parts.push('<MZ.Sequence.PreviewRenderingPresetPath>EncoderPresets/SequencePreview/795454d9-d3c2-429d-9474-923ab13b7018/I-Frame Only MPEG.epr</MZ.Sequence.PreviewRenderingPresetPath>');
  parts.push('<MZ.Sequence.PreviewUseMaxBitDepth>false</MZ.Sequence.PreviewUseMaxBitDepth>');
  parts.push('<MZ.Sequence.PreviewUseMaxRenderQuality>false</MZ.Sequence.PreviewUseMaxRenderQuality>');
  parts.push('<MZ.Sequence.VideoTimeDisplayFormat>102</MZ.Sequence.VideoTimeDisplayFormat>');
  parts.push('</Properties></Node>');
  parts.push('<AudioTrackGroup ObjectRef="76"/>');
  parts.push('<VideoTrackGroup ObjectRef="77"/>');
  parts.push(`<AudioVideoLinkGroup ObjectID="${nextId++}" ClassID="7269a316-0024-11d6-af2d-f718aa94d03c" Version="2"/>`);
  parts.push('<DefaultAudioTrackCount>1</DefaultAudioTrackCount>');
  parts.push('<DefaultVideoTrackCount>1</DefaultVideoTrackCount>');
  parts.push('</Sequence>');

  // --- AudioTrackGroup ---
  parts.push(
    '<AudioTrackGroup ObjectID="76" ClassID="9b9238b9-53a8-4cc3-b03f-b36246d052e6" Version="6">'
  );
  parts.push('<TrackGroup Version="1">');
  parts.push('<Tracks Version="1">');
  for (let i = 0; i < audioTracks.length; i++) {
    const trackUid = uuid();
    parts.push(`<Track Index="${i}" ObjectURef="${trackUid}"/>`);
  }
  if (audioTracks.length === 0) {
    // Always need at least one audio track for compatibility
    const trackUid = uuid();
    parts.push(`<Track Index="0" ObjectURef="${trackUid}"/>`);
  }
  parts.push('</Tracks>');
  parts.push(`<FrameRate>${audioFpsNumerator}</FrameRate>`);
  parts.push('<NextTrackID>8</NextTrackID>');
  parts.push('</TrackGroup>');
  const audioMixTrackId = nextId++;
  parts.push(`<MasterTrack ObjectRef="${audioMixTrackId}"/>`);
  parts.push('<AutomationSafeFlags>0</AutomationSafeFlags>');
  parts.push(`<ID>${uuid()}</ID>`);
  parts.push('<NumAdaptiveChannels>2</NumAdaptiveChannels>');
  parts.push('</AudioTrackGroup>');

  // --- VideoTrackGroup ---
  parts.push(
    '<VideoTrackGroup ObjectID="77" ClassID="9e9abf7a-0918-49c2-91ae-991b5dde77bb" Version="12">'
  );
  parts.push('<TrackGroup Version="1">');
  parts.push('<Tracks Version="1">');
  for (let i = 0; i < videoTracks.length; i++) {
    const trackUid = uuid();
    parts.push(`<Track Index="${i}" ObjectURef="${trackUid}"/>`);
  }
  if (videoTracks.length === 0) {
    const trackUid = uuid();
    parts.push(`<Track Index="0" ObjectURef="${trackUid}"/>`);
  }
  parts.push('</Tracks>');
  parts.push(`<FrameRate>${videoFpsNumerator}</FrameRate>`);
  parts.push('<NextTrackID>5</NextTrackID>');
  parts.push('</TrackGroup>');
  parts.push(`<FrameRect>0,0,${sequence.width},${sequence.height}</FrameRect>`);
  parts.push('<PixelAspectRatio>1,1</PixelAspectRatio>');
  parts.push('<FieldType>0</FieldType>');
  parts.push('<AllowLinearCompositing>true</AllowLinearCompositing>');
  parts.push('<ImmersiveVideoVRConfiguration>{"ambisonicsHRIR":"","ambisonicsMonitoringType":0,"capturedHorizontalView":0,"capturedVerticalView":0,"fieldOfHorizontalView":108,"fieldOfVerticalView":108,"projectionType":0,"stereoscopicEye":0,"stereoscopicType":0,"version":3}</ImmersiveVideoVRConfiguration>');
  parts.push('<WorkingColorSpaceConfiguration>{"workingSpaceConfigVersion":1,"workingSpaceID":"BT.709 RGB Full","workingSpaceIsLinearized":0}</WorkingColorSpaceConfiguration>');
  parts.push('<GraphicsWhiteConfiguration>100</GraphicsWhiteConfiguration>');
  parts.push('</VideoTrackGroup>');

  // --- AudioMixTrack ---
  const amtId = audioMixTrackId;
  parts.push(
    `<AudioMixTrack ObjectID="${amtId}" ClassID="4b1d8400-e89e-11d5-abc4-a1a13b1e80a0" Version="4">`
  );
  parts.push('<AudioTrack Version="11">');
  parts.push('<ComponentOwner Version="1">');
  const amtCompId = nextId++;
  parts.push(`<Components ObjectRef="${amtCompId}"/>`);
  parts.push('</ComponentOwner>');
  const amtPanId = nextId++;
  parts.push(`<Panner ObjectRef="${amtPanId}"/>`);
  parts.push('<SubType>3</SubType>');
  parts.push('<AutomationMode>1</AutomationMode>');
  parts.push('<Assign>0</Assign>');
  parts.push('<ChannelType>1</ChannelType>');
  parts.push(`<FrameRate>${audioFpsNumerator}</FrameRate>`);
  parts.push('<NextPannerID>4294967277</NextPannerID>');
  parts.push('<Solo>0</Solo>');
  parts.push('<MutedBySolo>0</MutedBySolo>');
  parts.push(`<ID>${uuid()}</ID>`);
  parts.push('</AudioTrack>');
  parts.push('<Track Version="3">');
  parts.push('<Node Version="1"><Properties Version="1">');
  parts.push('<TL.SQTrackAudioKeyframeStyle>2</TL.SQTrackAudioKeyframeStyle>');
  parts.push('<TL.SQTrackExpanded>0</TL.SQTrackExpanded>');
  parts.push('<TL.SQTrackExpandedHeight>25</TL.SQTrackExpandedHeight>');
  parts.push('<TL.SQTrackShy>0</TL.SQTrackShy>');
  parts.push('</Properties></Node>');
  parts.push('<MediaType>80b8e3d5-6dca-4195-aefb-cb5f407ab009</MediaType>');
  parts.push('<Index>0</Index>');
  parts.push('<ID>1</ID>');
  parts.push('<IsLocked>false</IsLocked>');
  parts.push('<IsSyncLocked>true</IsSyncLocked>');
  parts.push('<IsMuted>false</IsMuted>');
  parts.push('</Track>');
  const amtInletId = nextId++;
  parts.push(`<Inlet ObjectRef="${amtInletId}"/>`);
  parts.push('</AudioMixTrack>');

  // --- Audio Component Chain for mix track ---
  parts.push(
    `<AudioComponentChain ObjectID="${amtCompId}" ClassID="3cb131d1-d3c0-47ae-a19a-bdf75ea11674" Version="3">`
  );
  parts.push('<ComponentChain Version="3">');
  parts.push('<Components Version="1"/>');
  parts.push('</ComponentChain>');
  parts.push('<ChannelType>1</ChannelType>');
  parts.push(`<FrameRate>${audioFpsNumerator}</FrameRate>`);
  parts.push('<AutomationMode>1</AutomationMode>');
  parts.push('<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>');
  parts.push('</AudioComponentChain>');

  // --- StereoToStereoPanProcessor for mix ---
  parts.push(
    `<StereoToStereoPanProcessor ObjectID="${amtPanId}" ClassID="7bf86a01-efbe-11d5-abc4-c1ce2b1e9090" Version="1">`
  );
  parts.push('<PanProcessor Version="3">');
  parts.push('<AudioComponent Version="3">');
  parts.push('<Component Version="6">');
  parts.push('<Params Version="1"/>');
  parts.push('<ID>4294967278</ID>');
  parts.push('<Bypass>false</Bypass>');
  parts.push('<Intrinsic>false</Intrinsic>');
  parts.push('<ArchivedType>0</ArchivedType>');
  parts.push('</Component>');
  parts.push('<AudioComponentType>0</AudioComponentType>');
  parts.push(`<FrameRate>${audioFpsNumerator}</FrameRate>`);
  parts.push('<ChannelType>1</ChannelType>');
  parts.push('<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>');
  parts.push('</AudioComponent>');
  parts.push('</PanProcessor>');
  parts.push('</StereoToStereoPanProcessor>');

  // --- Individual AudioClipTracks ---
  const audioTrackUids: string[] = [];
  for (let ti = 0; ti < (audioTracks.length || 1); ti++) {
    const trackUid = uuid();
    audioTrackUids.push(trackUid);
    const trackClips = audioTracks.length > 0 ? audioTracks[ti][1].sort((a, b) => a.timelineStartMs - b.timelineStartMs) : [];
    const actId = nextId++;

    parts.push(
      `<AudioClipTrack ObjectUID="${trackUid}" ClassID="097f6203-99ae-11d5-84f2-8cf14bde7040" Version="6">`
    );
    parts.push('<ClipTrack Version="2">');
    parts.push('<Track Version="3">');
    parts.push('<Node Version="1"><Properties Version="1">');
    parts.push('<MZ.SourceTrackNumber>-1</MZ.SourceTrackNumber>');
    parts.push('<MZ.SourceTrackState>0</MZ.SourceTrackState>');
    parts.push('<TL.SQTrackAudioKeyframeStyle>0</TL.SQTrackAudioKeyframeStyle>');
    parts.push('<TL.SQTrackExpanded>0</TL.SQTrackExpanded>');
    parts.push('<TL.SQTrackExpandedHeight>25</TL.SQTrackExpandedHeight>');
    parts.push('<TL.SQTrackShy>0</TL.SQTrackShy>');
    parts.push('</Properties></Node>');
    parts.push('<MediaType>80b8e3d5-6dca-4195-aefb-cb5f407ab009</MediaType>');
    parts.push(`<Index>${ti}</Index>`);
    parts.push(`<ID>${ti + 4}</ID>`);
    parts.push('<IsLocked>false</IsLocked>');
    parts.push('<IsSyncLocked>true</IsSyncLocked>');
    parts.push('<IsMuted>false</IsMuted>');
    parts.push('</Track>');
    parts.push('<ClipItems Version="3">');
    if (trackClips.length > 0) {
      parts.push('<TrackItems Version="1">');
      for (let ci = 0; ci < trackClips.length; ci++) {
        const actiId = nextId++;
        parts.push(`<TrackItem Index="${ci}" ObjectRef="${actiId}"/>`);
      }
      parts.push('</TrackItems>');
    }
    parts.push(`<MediaType>80b8e3d5-6dca-4195-aefb-cb5f407ab009</MediaType>`);
    parts.push(`<Index>${ti}</Index>`);
    parts.push('</ClipItems>');
    parts.push('<TransitionItems Version="3">');
    parts.push(`<MediaType>80b8e3d5-6dca-4195-aefb-cb5f407ab009</MediaType>`);
    parts.push(`<Index>${ti}</Index>`);
    parts.push('</TransitionItems>');
    parts.push('</ClipTrack>');
    // AudioTrack sub-object
    const actCompId = nextId++;
    const actPanId = nextId++;
    parts.push('<AudioTrack Version="11">');
    parts.push('<ComponentOwner Version="1">');
    parts.push(`<Components ObjectRef="${actCompId}"/>`);
    parts.push('</ComponentOwner>');
    parts.push(`<Panner ObjectRef="${actPanId}"/>`);
    parts.push('<SubType>1</SubType>');
    parts.push('<AutomationMode>1</AutomationMode>');
    parts.push('<Assign>1</Assign>');
    parts.push('<ChannelType>1</ChannelType>');
    parts.push(`<FrameRate>${audioFpsNumerator}</FrameRate>`);
    parts.push('<NextPannerID>4294967277</NextPannerID>');
    parts.push('<Solo>0</Solo>');
    parts.push('<MutedBySolo>0</MutedBySolo>');
    parts.push(`<ID>${uuid()}</ID>`);
    parts.push('</AudioTrack>');
    parts.push('<RecordChannel>0</RecordChannel>');
    parts.push('</AudioClipTrack>');

    // AudioComponentChain + PanProcessor for this track
    parts.push(
      `<AudioComponentChain ObjectID="${actCompId}" ClassID="3cb131d1-d3c0-47ae-a19a-bdf75ea11674" Version="3">`
    );
    parts.push('<ComponentChain Version="3">');
    parts.push('<Components Version="1"/>');
    parts.push('</ComponentChain>');
    parts.push('<ChannelType>1</ChannelType>');
    parts.push(`<FrameRate>${audioFpsNumerator}</FrameRate>`);
    parts.push('<AutomationMode>1</AutomationMode>');
    parts.push('<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>');
    parts.push('</AudioComponentChain>');
    parts.push(
      `<StereoToStereoPanProcessor ObjectID="${actPanId}" ClassID="7bf86a01-efbe-11d5-abc4-c1ce2b1e9090" Version="1">`
    );
    parts.push('<PanProcessor Version="3"><AudioComponent Version="3"><Component Version="6">');
    parts.push('<Params Version="1"/>');
    parts.push('<ID>4294967278</ID>');
    parts.push('<Bypass>false</Bypass>');
    parts.push('<Intrinsic>false</Intrinsic>');
    parts.push('<ArchivedType>0</ArchivedType>');
    parts.push('</Component></AudioComponent></PanProcessor>');
    parts.push('</StereoToStereoPanProcessor>');
  }

  // --- Individual VideoClipTracks ---
  const videoTrackUids: string[] = [];
  for (let ti = 0; ti < (videoTracks.length || 1); ti++) {
    const trackUid = uuid();
    videoTrackUids.push(trackUid);
    const trackClips = videoTracks.length > 0 ? videoTracks[ti][1].sort((a, b) => a.timelineStartMs - b.timelineStartMs) : [];
    const vctId = nextId++;

    parts.push(
      `<VideoClipTrack ObjectUID="${trackUid}" ClassID="f68dcd81-8805-11d5-af2d-9bfa89d4ddd4" Version="1">`
    );
    parts.push('<ClipTrack Version="2">');
    parts.push('<Track Version="3">');
    parts.push('<Node Version="1"><Properties Version="1">');
    parts.push(`<MZ.SourceTrackNumber>${ti === 0 ? '0' : '-1'}</MZ.SourceTrackNumber>`);
    parts.push('<MZ.SourceTrackState>0</MZ.SourceTrackState>');
    if (ti === 0) parts.push('<MZ.TrackTargeted>1</MZ.TrackTargeted>');
    parts.push('<TL.SQTrackExpanded>0</TL.SQTrackExpanded>');
    parts.push('<TL.SQTrackExpandedHeight>25</TL.SQTrackExpandedHeight>');
    parts.push('<TL.SQTrackShy>0</TL.SQTrackShy>');
    parts.push('</Properties></Node>');
    parts.push('<MediaType>228cda18-3625-4d2d-951e-348879e4ed93</MediaType>');
    parts.push(`<Index>${ti}</Index>`);
    parts.push(`<ID>${ti + 1}</ID>`);
    parts.push('<IsLocked>false</IsLocked>');
    parts.push('<IsSyncLocked>true</IsSyncLocked>');
    parts.push('<IsMuted>false</IsMuted>');
    parts.push('</Track>');
    parts.push('<ClipItems Version="3">');
    if (trackClips.length > 0) {
      parts.push('<TrackItems Version="1">');
      for (let ci = 0; ci < trackClips.length; ci++) {
        const vctiId = nextId++;
        parts.push(`<TrackItem Index="${ci}" ObjectRef="${vctiId}"/>`);
      }
      parts.push('</TrackItems>');
    }
    parts.push('<MediaType>228cda18-3625-4d2d-951e-348879e4ed93</MediaType>');
    parts.push(`<Index>${ti}</Index>`);
    parts.push('</ClipItems>');
    parts.push('<TransitionItems Version="3">');
    parts.push('<MediaType>228cda18-3625-4d2d-951e-348879e4ed93</MediaType>');
    parts.push(`<Index>${ti}</Index>`);
    parts.push('</TransitionItems>');
    parts.push('</ClipTrack>');
    parts.push('</VideoClipTrack>');
  }

  // --- AudioClipTrackItems ---
  for (let ti = 0; ti < (audioTracks.length || 0); ti++) {
    const trackClips = audioTracks[ti][1].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    for (let ci = 0; ci < trackClips.length; ci++) {
      const clip = trackClips[ci];
      const mcUid = clipToMasterClipUid.get(clip.id);
      if (!mcUid) continue;
      const { startFrame, durationFrames } = clipTimelineFrames(clip, fps);
      const startTicks = startFrame * (audioFpsNumerator / fps);
      const endTicks = (startFrame + durationFrames) * (audioFpsNumerator / fps);
      const actiId = nextId++;

      parts.push(
        `<AudioClipTrackItem ObjectID="${actiId}" ClassID="064ec682-9ba6-11d5-af2d-9ca32c7d6164" Version="6">`
      );
      parts.push('<ClipTrackItem Version="8">');
      parts.push('<ComponentOwner Version="1">');
      const accId = nextId++;
      parts.push(`<Components ObjectRef="${accId}"/>`);
      parts.push('</ComponentOwner>');
      parts.push('<TrackItem Version="3">');
      parts.push(`<Start>${startTicks}</Start>`);
      parts.push(`<End>${endTicks}</End>`);
      parts.push('</TrackItem>');
      const scRefId = nextId++;
      parts.push(`<SubClip ObjectRef="${scRefId}"/>`);
      parts.push('</ClipTrackItem>');
      parts.push(`<ID>${uuid()}</ID>`);
      parts.push('</AudioClipTrackItem>');

      // SubClip ref object
      parts.push(
        `<SubClip ObjectID="${scRefId}" ClassID="364de0aa-81e6-46fd-8088-913ffceebd7f" Version="15">`
      );
      parts.push(`<MasterClip ObjectURef="${mcUid}"/>`);
      parts.push('</SubClip>');

      // AudioComponentChain
      parts.push(
        `<AudioComponentChain ObjectID="${accId}" ClassID="3cb131d1-d3c0-47ae-a19a-bdf75ea11674" Version="3">`
      );
      parts.push('<ComponentChain Version="3"><Components Version="1"/></ComponentChain>');
      parts.push('<ChannelType>1</ChannelType>');
      parts.push(`<FrameRate>${audioFpsNumerator}</FrameRate>`);
      parts.push('<AutomationMode>1</AutomationMode>');
      parts.push('<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>');
      parts.push('</AudioComponentChain>');
    }
  }

  // --- VideoClipTrackItems ---
  for (let ti = 0; ti < (videoTracks.length || 0); ti++) {
    const trackClips = videoTracks[ti][1].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    for (let ci = 0; ci < trackClips.length; ci++) {
      const clip = trackClips[ci];
      const mcUid = clipToMasterClipUid.get(clip.id);
      if (!mcUid) continue;
      const { startFrame, durationFrames } = clipTimelineFrames(clip, fps);
      const startTicks = startFrame * (videoFpsNumerator / fps);
      const endTicks = (startFrame + durationFrames) * (videoFpsNumerator / fps);
      const vctiId = nextId++;

      parts.push(
        `<VideoClipTrackItem ObjectID="${vctiId}" ClassID="368b0406-29e3-4923-9fcd-094fbf9a1089" Version="6">`
      );
      parts.push('<ClipTrackItem Version="8">');
      parts.push('<ComponentOwner Version="1">');
      const vccId = nextId++;
      parts.push(`<Components ObjectRef="${vccId}"/>`);
      parts.push('</ComponentOwner>');
      parts.push('<TrackItem Version="3">');
      parts.push(`<Start>${startTicks}</Start>`);
      parts.push(`<End>${endTicks}</End>`);
      parts.push('</TrackItem>');
      const scRefId = nextId++;
      parts.push(`<SubClip ObjectRef="${scRefId}"/>`);
      parts.push('</ClipTrackItem>');
      parts.push(`<ID>${uuid()}</ID>`);
      parts.push('</VideoClipTrackItem>');

      // SubClip ref object
      parts.push(
        `<SubClip ObjectID="${scRefId}" ClassID="364de0aa-81e6-46fd-8088-913ffceebd7f" Version="15">`
      );
      parts.push(`<MasterClip ObjectURef="${mcUid}"/>`);
      parts.push('</SubClip>');

      // VideoComponentChain
      parts.push(
        `<VideoComponentChain ObjectID="${vccId}" ClassID="3cb131d1-d3c0-47ae-a19a-bdf75ea11674" Version="3">`
      );
      parts.push('<ComponentChain Version="3"><Components Version="1"/></ComponentChain>');
      parts.push('</VideoComponentChain>');
    }
  }

  // --- Inlet for AudioMixTrack ---
  parts.push(
    `<Inlet ObjectID="${amtInletId}" ClassID="4b1d8400-e89e-11d5-abc4-a1a13b1e80a1" Version="1">`
  );
  parts.push('<Inlet Version="1">');
  parts.push('<AudioComponent Version="3"><Component Version="6"><Params Version="1"/>');
  parts.push('<ID>1</ID><Bypass>false</Bypass><Intrinsic>false</Intrinsic><ArchivedType>0</ArchivedType>');
  parts.push('</Component></AudioComponent>');
  parts.push('</Inlet>');
  parts.push('</Inlet>');

  // --- CaptionSettings (required for CC 2025+) ---
  parts.push(
    '<CaptionSettings ObjectID="' + nextId++ + '" ClassID="b3d79aa4-3c1f-4ce9-a87b-0c8f5b5c7e3b" Version="1">'
  );
  parts.push('<CaptionStreams Version="1"/>');
  parts.push('</CaptionSettings>');

  // End
  parts.push('</PremiereData>');

  return parts.join('\n');
}

/** Build .prproj (gzip-compressed XML). */
export function buildPremiereProProject(ir: EditTimelineIR): Buffer {
  const xml = buildPremiereProXml(ir);
  return gzipSync(xml, { level: 6 });
}

export function buildPremiereProReadme(ir: EditTimelineIR): string {
  const durSec = (ir.totalDurationMs / 1000).toFixed(2);
  return `MagineCanvas 剪辑台 → Adobe Premiere Pro 原生工程

1. 解压本 zip，保持 media/ 文件夹与 .prproj 文件在同一目录。
2. 双击 .prproj 文件在 Premiere Pro 中打开项目。
3. 若提示素材脱机，在项目面板中使用"链接媒体"指向本目录下的 media/ 文件夹。
4. 序列设置：${ir.sequence.width}x${ir.sequence.height} @ ${ir.sequence.fps}fps，总时长约 ${durSec}s。

说明：已导出剪辑轨道中的片段位置、裁剪入出点、视频/图片轨和音频轨；特效、字幕、调色请在 PR 中继续制作。`;
}
