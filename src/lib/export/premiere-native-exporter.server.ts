import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EditTimelineIR } from '@/lib/edit-timeline-ir';

const PREMIERE_PROCESS_NAME = 'Adobe Premiere Pro.exe';
const PROJECT_BASENAME = 'MagineCanvas_Edit';

function execFileText(
  file: string,
  args: string[],
  timeout = 15_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function readRegistryDefaultValue(key: string): Promise<string> {
  try {
    const output = await execFileText('reg.exe', ['query', key, '/ve']);
    const valueLine = output
      .split(/\r?\n/)
      .find((line) => /\bREG_\w+\b/.test(line));
    return valueLine?.replace(/^.*?\bREG_\w+\b\s+/, '').trim() || '';
  } catch {
    return '';
  }
}

function executableFromOpenCommand(command: string): string {
  const quoted = command.match(/^\s*"([^"]+\.exe)"/i);
  if (quoted?.[1]) return quoted[1];
  const unquoted = command.match(/^\s*(.+?\.exe)(?:\s|$)/i);
  return unquoted?.[1]?.trim() || '';
}

async function findPremiereExecutable(): Promise<string> {
  const configured = process.env.MAGINE_PREMIERE_PATH?.trim() || '';
  if (configured && path.isAbsolute(configured)) {
    try {
      await fs.access(configured);
      return configured;
    } catch {
      // Fall through to the registered .prproj file association.
    }
  }

  if (process.platform !== 'win32') return '';

  const projectClass = await readRegistryDefaultValue('HKCR\\.prproj');
  if (!projectClass) return '';
  const openCommand = await readRegistryDefaultValue(
    `HKCR\\${projectClass}\\shell\\open\\command`,
  );
  const executable = executableFromOpenCommand(openCommand);
  if (!executable) return '';

  try {
    await fs.access(executable);
    return executable;
  } catch {
    return '';
  }
}

async function isPremiereRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const output = await execFileText(
      'tasklist.exe',
      ['/FI', `IMAGENAME eq ${PREMIERE_PROCESS_NAME}`, '/FO', 'CSV', '/NH'],
      10_000,
    );
    return output.toLowerCase().includes(PREMIERE_PROCESS_NAME.toLowerCase());
  } catch {
    return false;
  }
}

function jsxString(value: string): string {
  return JSON.stringify(value.replace(/\\/g, '/')).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function buildConversionScript(opts: {
  xmlPath: string;
  outputDir: string;
  statusPath: string;
  mediaFolders?: Array<{
    name: string;
    absolutePaths: string[];
    timelineItems?: Array<{ currentPath: string; folderPath?: string }>;
  }>;
}): string {
  const mediaFolders = (opts.mediaFolders || []).map((folder) => ({
    name: folder.name,
    paths: folder.absolutePaths,
    timelineItems: folder.timelineItems || [],
  }));
  return `var xmlPath = ${jsxString(opts.xmlPath)};
var outputDir = ${jsxString(opts.outputDir)};
var statusPath = ${jsxString(opts.statusPath)};
var mediaFolders = ${JSON.stringify(mediaFolders).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )};
var status = "error:Premiere conversion did not start";
function normalizedMediaPath(value) {
  return String(value || "").replace(/\\\\/g, "/").toLowerCase();
}
function projectItemsByMediaPath(mediaPath) {
  var matches = app.project.rootItem.findItemsMatchingMediaPath(mediaPath, 1);
  if (matches && matches.length) {
    return matches;
  }
  var fallback = [];
  function visit(parent) {
    if (!parent || !parent.children) return;
    var count = typeof parent.children.numItems === "number"
      ? parent.children.numItems
      : parent.children.length;
    for (var index = 0; index < count; index += 1) {
      var item = parent.children[index];
      if (!item) continue;
      if (item.type === ProjectItemType.BIN) {
        visit(item);
      } else if (
        typeof item.getMediaPath === "function"
        && normalizedMediaPath(item.getMediaPath()) === normalizedMediaPath(mediaPath)
      ) {
        fallback.push(item);
      }
    }
  }
  visit(app.project.rootItem);
  return fallback;
}
try {
  if (!app.openFCPXML(xmlPath, outputDir)) {
    throw new Error("app.openFCPXML returned false");
  }
  if (!app.project) {
    throw new Error("Premiere did not create a project");
  }
  if (app.project.sequences.numSequences < 1) {
    throw new Error("Premiere project contains no sequence");
  }
  if (!app.project.openSequence(app.project.sequences[0].sequenceID)) {
    throw new Error("Premiere could not open the exported sequence");
  }
  var importedAssetCount = 0;
  var movedTimelineCount = 0;
  var movedNodeIds = {};
  for (var folderIndex = 0; folderIndex < mediaFolders.length; folderIndex += 1) {
    var folder = mediaFolders[folderIndex];
    var bin = app.project.rootItem.createBin(folder.name);
    if (!bin) {
      throw new Error("Premiere could not create media bin: " + folder.name);
    }
    var folderTimelinePaths = {};
    for (var timelineIndex = 0; timelineIndex < folder.timelineItems.length; timelineIndex += 1) {
      var timelineItem = folder.timelineItems[timelineIndex];
      var matches = projectItemsByMediaPath(timelineItem.currentPath);
      if (!matches || matches.length === 0) {
        throw new Error("Premiere could not locate timeline media: " + timelineItem.currentPath);
      }
      for (var matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
        var projectItem = matches[matchIndex];
        if (!projectItem || movedNodeIds[projectItem.nodeId]) continue;
        var moved = projectItem.moveBin(bin);
        if (moved === false || (typeof moved === "number" && moved !== 0)) {
          throw new Error("Premiere could not move timeline media into bin: " + folder.name);
        }
        movedNodeIds[projectItem.nodeId] = true;
        movedTimelineCount += 1;
      }
      if (timelineItem.folderPath) {
        folderTimelinePaths[normalizedMediaPath(timelineItem.folderPath)] = true;
      }
    }
    var pathsToImport = [];
    for (var pathIndex = 0; pathIndex < folder.paths.length; pathIndex += 1) {
      if (!folderTimelinePaths[normalizedMediaPath(folder.paths[pathIndex])]) {
        pathsToImport.push(folder.paths[pathIndex]);
      }
    }
    if (pathsToImport.length > 0) {
      var imported = app.project.importFiles(pathsToImport, true, bin, false);
      if (imported === false) {
        throw new Error("Premiere could not import media bin: " + folder.name);
      }
      importedAssetCount += pathsToImport.length;
    }
  }
  app.project.save();
  app.project.closeDocument(1, 0);
  status = "ok:" + mediaFolders.length + ":" + importedAssetCount + ":" + movedTimelineCount;
} catch (error) {
  status = "error:" + String(error);
  try {
    if (app.project) app.project.closeDocument(0, 0);
  } catch (closeError) {}
}
var statusFile = new File(statusPath);
if (statusFile.open("w")) {
  statusFile.write(status);
  statusFile.close();
}
app.quit();
`;
}

export async function createNativePremiereProject(opts: {
  outputDir: string;
  xmeml: string;
  mediaFolders?: Array<{
    name: string;
    absolutePaths: string[];
    timelineItems?: Array<{ currentPath: string; folderPath?: string }>;
  }>;
}): Promise<string> {
  const premiereExecutable = await findPremiereExecutable();
  if (!premiereExecutable) {
    throw new Error('未找到 Adobe Premiere Pro，无法生成原生 PR 工程。');
  }
  if (await isPremiereRunning()) {
    throw new Error('Adobe Premiere Pro 正在运行，请先关闭 Premiere Pro，再重新导出 PR 工程。');
  }

  const xmlPath = path.join(opts.outputDir, `${PROJECT_BASENAME}.xml`);
  const scriptPath = path.join(opts.outputDir, '.magine-create-premiere.jsx');
  const statusPath = path.join(opts.outputDir, '.magine-premiere-status.txt');
  const projectPath = path.join(opts.outputDir, `${PROJECT_BASENAME}.prproj`);

  await fs.mkdir(opts.outputDir, { recursive: true });
  await fs.writeFile(xmlPath, opts.xmeml, 'utf8');
  await fs.writeFile(
    scriptPath,
    buildConversionScript({
      xmlPath,
      outputDir: opts.outputDir,
      statusPath,
      mediaFolders: opts.mediaFolders,
    }),
    'utf8',
  );

  let commandError = '';
  try {
    await execFileText(
      premiereExecutable,
      ['/C', 'es.processFile', scriptPath],
      120_000,
    );
  } catch (error) {
    commandError = error instanceof Error ? error.message : String(error);
  }

  let conversionStatus = '';
  try {
    conversionStatus = await fs.readFile(statusPath, 'utf8');
  } catch {
    // The command error below gives a more useful failure message.
  }

  let projectSize = 0;
  try {
    projectSize = (await fs.stat(projectPath)).size;
  } catch {
    // The normalized conversion error below is shown to the user.
  } finally {
    await Promise.all([
      fs.rm(xmlPath, { force: true }),
      fs.rm(scriptPath, { force: true }),
      fs.rm(statusPath, { force: true }),
    ]);
  }

  if (!conversionStatus.trim().startsWith('ok:') || projectSize < 1024) {
    throw new Error(
      `PR 工程转换失败：${conversionStatus.trim().replace(/^error:/, '') || commandError || '未生成有效工程文件'}`,
    );
  }

  return projectPath;
}

export function buildNativePremiereReadme(ir: EditTimelineIR): string {
  const durationSeconds = (ir.totalDurationMs / 1000).toFixed(2);
  return `MagineCanvas 导演组合 -> Adobe Premiere Pro 原生工程

1. 双击 MagineCanvas_Edit.prproj 打开工程。
2. media 文件夹必须与工程文件保持在同一目录。
3. “序列素材”目录包含音乐及按序列分类的全部素材；Premiere 项目面板根目录会直接创建音乐和各序列媒体箱，时间线已用素材与备选素材都归入对应媒体箱，不会在根目录重复平铺。
4. 如 Premiere 提示素材脱机，请使用“链接媒体”并选择当前目录下的 media 或“序列素材”文件夹。
5. 序列规格：${ir.sequence.width}x${ir.sequence.height} @ ${ir.sequence.fps}fps，总时长约 ${durationSeconds} 秒。
`;
}
