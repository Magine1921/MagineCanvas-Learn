import type { EditTimelineIR } from '@/lib/edit-timeline-ir';
import { clipTimelineFrames, getMaterialForClip } from '@/lib/edit-timeline-ir';

function jsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** ExtendScript：按真实剪辑轨道创建合成与图层。 */
export function buildAeExtendScript(ir: EditTimelineIR): string {
  const { sequence, clips } = ir;
  const sorted = [...clips].sort((a, b) => a.trackIndex - b.trackIndex || a.timelineStartMs - b.timelineStartMs);
  const compName = 'MagineCanvas_Edit';
  const lines: string[] = [
    '// MagineCanvas Edit Station - Auto-generated ExtendScript',
    '// 在 After Effects 中：文件 -> 脚本 -> 运行脚本文件',
    '',
    '(function () {',
    `  var compName = "${jsString(compName)}";`,
    `  var compW = ${sequence.width};`,
    `  var compH = ${sequence.height};`,
    `  var fps = ${sequence.fps};`,
    `  var totalDur = ${(ir.totalDurationMs / 1000).toFixed(3)};`,
    '  var scriptFile = new File($.fileName);',
    '  var scriptFolder = scriptFile.parent;',
    '  var mediaFolder = new Folder(scriptFolder.fsName + "/../media");',
    '  if (!mediaFolder.exists) {',
    '    alert("未找到 media 文件夹，请保持 scripts/ 与 media/ 的相对位置。");',
    '    return;',
    '  }',
    '  var comp = app.project.items.addComp(compName, compW, compH, 1, totalDur, fps);',
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
    lines.push(
      `  // track ${clip.trackIndex}, clip ${idx + 1}`,
      '  (function () {',
      `    var f = new File(mediaFolder.fsName + "/${jsString(rel)}");`,
      '    if (!f.exists) return;',
      '    var io = new ImportOptions(f);',
      '    io.importAs = ImportAsType.FOOTAGE;',
      '    var footage = app.project.importFile(io);',
      '    var layer = comp.layers.add(footage);',
      `    layer.startTime = ${startSec} - ${inSec};`,
      `    layer.inPoint = ${startSec};`,
      `    layer.outPoint = ${startSec} + ${durSec};`,
      `    layer.name = "${jsString(clip.fileName || mat.fileName || `clip_${idx + 1}`)}";`,
      '  })();',
      ''
    );
  });

  lines.push('  app.project.activeItem = comp;', '  alert("合成已创建：" + compName);', '})();');
  return lines.join('\n');
}
