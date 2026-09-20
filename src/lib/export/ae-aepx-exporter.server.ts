import crypto from 'node:crypto';
import type { EditTimelineIR } from '@/lib/edit-timeline-ir';
import { clipTimelineFrames, getMaterialForClip } from '@/lib/edit-timeline-ir';

function uuid(): string {
  return crypto.randomUUID();
}

function hexId(prefix: string): string {
  // AE uses hex-based IDs like 0001, 0004, 0007
  return prefix + crypto.randomBytes(8).toString('hex').slice(0, 8);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build After Effects .aepx project XML.
 * .aepx is AE's XML-based project format (CC 2019+).
 * It can contain compositions, footage items, and layer placement.
 * Complex animation data is hex-encoded; this generates basic clip placement.
 */
export function buildAeAepxProject(ir: EditTimelineIR): string {
  const { sequence, clips } = ir;
  const fps = sequence.fps;
  const compDurSec = ir.totalDurationMs / 1000;
  const compId = hexId('0004');
  const folderId = hexId('0001');

  // Sort clips by track then timeline position
  const sorted = [...clips].sort(
    (a, b) => a.trackIndex - b.trackIndex || a.timelineStartMs - b.timelineStartMs
  );

  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Project>');

  // Root folder
  lines.push(`<Item><idta>${folderId}</idta>`);
  lines.push('<Sfdr>');

  // Composition
  lines.push(`<Item><idta>${compId}</idta>`);
  lines.push(`<btdur>${Math.round(compDurSec * fps)}</btdur>`);
  lines.push(`<rate>${fps}</rate>`);
  lines.push(`<width>${sequence.width}</width>`);
  lines.push(`<height>${sequence.height}</height>`);
  lines.push(`<string>MagineCanvas_Edit</string>`);
  lines.push('<Layr>');

  // Layers for each clip (bottom-to-top in AE, so reverse order)
  const reversed = [...sorted].reverse();
  for (let i = 0; i < reversed.length; i++) {
    const clip = reversed[i];
    const mat = getMaterialForClip(ir, clip.id);
    if (!mat) continue;

    const { startFrame, durationFrames, inFrame } = clipTimelineFrames(clip, fps);
    const startSec = startFrame / fps;
    const durSec = durationFrames / fps;
    const inSec = inFrame / fps;

    // Layer
    lines.push('<Item>');
    lines.push(`<idta>${hexId('0010')}</idta>`); // Layer type
    lines.push(`<string>${xmlEscape(clip.fileName || mat.fileName || `Layer_${i + 1}`)}</string>`);
    lines.push(`<start>${startSec.toFixed(4)}</start>`);
    lines.push(`<in>${inSec.toFixed(4)}</in>`);
    lines.push(`<dur>${durSec.toFixed(4)}</dur>`);
    lines.push(`<source>${xmlEscape(mat.relativePath)}</source>`);
    lines.push('</Item>');
  }

  lines.push('</Layr>');
  lines.push('</Item>'); // close comp

  lines.push('</Sfdr>');
  lines.push('</Item>'); // close folder

  lines.push('</Project>');
  return lines.join('\n');
}

/**
 * Build enhanced After Effects ExtendScript (.jsx).
 * This is the recommended approach for programmatic AE comp creation.
 * When run in AE (File → Scripts → Run Script File), it creates a composition
 * with all clips placed correctly on the timeline.
 */
export function buildAeExtendScript(ir: EditTimelineIR): string {
  const { sequence, clips } = ir;
  const sorted = [...clips].sort((a, b) => a.trackIndex - b.trackIndex || a.timelineStartMs - b.timelineStartMs);
  const compName = 'MagineCanvas_Edit';
  const lines: string[] = [
    '// MagineCanvas Edit Station — After Effects ExtendScript',
    '// 在 After Effects 中：文件 → 脚本 → 运行脚本文件',
    '// 请确保 media/ 文件夹与 scripts/ 文件夹在同一目录',
    '',
    '(function () {',
    '  app.beginUndoGroup("MagineCanvas Edit Station");',
    `  var compName = "${jsString(compName)}";`,
    `  var compW = ${sequence.width};`,
    `  var compH = ${sequence.height};`,
    `  var fps = ${sequence.fps};`,
    `  var totalDur = ${(ir.totalDurationMs / 1000).toFixed(3)};`,
    '  var scriptFile = new File($.fileName);',
    '  var scriptFolder = scriptFile.parent;',
    '  var mediaFolder = new Folder(scriptFolder.fsName + "/../media");',
    '  if (!mediaFolder.exists) {',
    '    alert("未找到 media 文件夹\\n请保持 scripts/ 与 media/ 的相对位置不变。");',
    '    app.endUndoGroup();',
    '    return;',
    '  }',
    '',
    '  // Create composition',
    `  var comp = app.project.items.addComp(compName, compW, compH, 1, totalDur, fps);`,
    `  comp.bgColor = [0, 0, 0];`,
    '  comp.displayStartTime = 0;',
    '',
    '  var importedFootage = {};',
    '  var errors = [];',
    '',
  ];

  sorted.forEach((clip, idx) => {
    const mat = getMaterialForClip(ir, clip.id);
    if (!mat) return;
    const { startFrame, durationFrames, inFrame } = clipTimelineFrames(clip, sequence.fps);
    const startSec = (startFrame / sequence.fps).toFixed(4);
    const inSec = (inFrame / sequence.fps).toFixed(4);
    const durSec = (durationFrames / sequence.fps).toFixed(4);
    const rel = mat.relativePath.replace(/\\/g, '/').replace(/^media\//, '');
    const clipName = jsString(clip.fileName || mat.fileName || `clip_${idx + 1}`);

    lines.push(
      `  // Track ${clip.trackIndex}, Clip ${idx + 1}: ${clipName}`,
      '  try {',
      `    var mediaPath = mediaFolder.fsName + "/${jsString(rel)}";`,
      `    var key = "${jsString(rel)}";`,
      '    var footage = importedFootage[key];',
      '    if (!footage) {',
      '      var f = new File(mediaPath);',
      '      if (!f.exists) {',
      `        errors.push("素材不存在: ${clipName}");`,
      '      } else {',
      '        var io = new ImportOptions(f);',
      `        io.importAs = ${clip.mediaKind === 'image' ? 'ImportAsType.FOOTAGE' : 'ImportAsType.FOOTAGE'};`,
      '        footage = app.project.importFile(io);',
      '        importedFootage[key] = footage;',
      '      }',
      '    }',
      '    if (footage) {',
      '      // Place on timeline',
      `      var layer = comp.layers.add(footage);`,
      `      layer.startTime = ${startSec} - ${inSec};`,
      `      layer.inPoint = ${startSec};`,
      `      layer.outPoint = ${startSec} + ${durSec};`,
      `      layer.name = "${clipName}";`,
      '      // Fit to comp if image',
      `${clip.mediaKind === 'image' ? `      var s = layer.property("ADBE Transform Group").property("ADBE Scale");\n      if (s) {\n        var wRatio = compW / (footage.width || compW);\n        var hRatio = compH / (footage.height || compH);\n        var fitScale = Math.min(wRatio, hRatio) * 100;\n        s.setValue([fitScale, fitScale]);\n      }` : ''}`,
      '    }',
      '  } catch (e) {',
      `    errors.push("${clipName}: " + e.toString());`,
      '  }',
      ''
    );
  });

  lines.push(
    '  app.project.activeItem = comp;',
    '  app.endUndoGroup();',
    '  if (errors.length > 0) {',
    `    alert("合成已创建：" + compName + "\\n\\n警告：\\n" + errors.join("\\n"));`,
    '  } else {',
    `    alert("合成已创建：" + compName + "\\n共 " + comp.layers.length + " 个图层。");`,
    '  }',
    '})();'
  );

  return lines.join('\n');
}

export function buildAeReadme(ir: EditTimelineIR): string {
  const durSec = (ir.totalDurationMs / 1000).toFixed(2);
  return `MagineCanvas 剪辑台 → Adobe After Effects 原生工程

方式 A（推荐 — ExtendScript 脚本重建合成）：
  1. 解压 zip，在 AE 中：文件 → 脚本 → 运行脚本文件
  2. 选择 scripts/build_edit_station_comp.jsx
  3. 脚本会自动创建 "MagineCanvas_Edit" 合成并按剪辑轨道放置所有片段

方式 B（.aepx 项目文件）：
  1. 在 AE 中：文件 → 打开项目 → 选择 MagineCanvas_Edit.aepx
  2. 按提示链接 media/ 中的素材文件

序列设置：${ir.sequence.width}x${ir.sequence.height} @ ${ir.sequence.fps}fps
总时长：约 ${durSec}s
总片段数：${ir.clips.length} 个

说明：已导出剪辑轨道中的片段位置、裁剪入出点、视频/图片轨和音频轨；特效、关键帧动画、字幕、调色请在 AE 中继续制作。`;
}
