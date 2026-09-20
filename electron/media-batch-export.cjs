const path = require('path');
const fs = require('fs');

function sanitizeFolderName(value) {
  let name = String(value || '节点素材')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .slice(0, 120) || '节点素材';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `${name}-素材`;
  return name;
}

async function createUniqueDirectory(parentDirectory, requestedName) {
  const baseName = sanitizeFolderName(requestedName);
  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? '' : ` (${index})`;
    const candidate = path.join(parentDirectory, `${baseName}${suffix}`);
    try {
      await fs.promises.mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`无法为“${baseName}”创建唯一文件夹`);
}

async function uniqueFilePath(directory, requestedName, sanitizeFileName) {
  const safeName = sanitizeFileName(requestedName);
  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  for (let index = 1; index <= 9999; index += 1) {
    const suffix = index === 1 ? '' : ` (${index})`;
    const candidate = path.join(directory, `${baseName}${suffix}${extension}`);
    try {
      await fs.promises.access(candidate, fs.constants.F_OK);
    } catch {
      return candidate;
    }
  }
  throw new Error(`无法为“${safeName}”创建唯一文件名`);
}

async function exportMediaGroups({
  baseDirectory,
  groups,
  sanitizeFileName,
  writeSource,
  onProgress,
}) {
  const folderResults = [];
  let savedCount = 0;
  let failedCount = 0;
  let completedCount = 0;
  const totalCount = groups.reduce((total, group) => total + group.items.length, 0);

  const reportProgress = (nodeId = '', fileName = '') => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({
        completedCount,
        totalCount,
        savedCount,
        failedCount,
        nodeId,
        fileName,
      });
    } catch {
      /* progress reporting must never interrupt file export */
    }
  };

  reportProgress();

  for (const group of groups) {
    const folderPath = await createUniqueDirectory(baseDirectory, group.folderName);
    let groupSavedCount = 0;
    let groupFailedCount = 0;

    for (let index = 0; index < group.items.length; index += 1) {
      const item = group.items[index];
      let tempPath = '';
      try {
        const destination = await uniqueFilePath(folderPath, item.suggestedName, sanitizeFileName);
        tempPath = path.join(
          folderPath,
          `.${path.basename(destination)}.${process.pid}.${Date.now()}.${index}.export`,
        );
        await writeSource(item, tempPath);
        await fs.promises.rename(tempPath, destination);
        groupSavedCount += 1;
        savedCount += 1;
      } catch (error) {
        if (tempPath) await fs.promises.rm(tempPath, { force: true }).catch(() => {});
        groupFailedCount += 1;
        failedCount += 1;
        console.error('[electron] batch media item save failed:', error instanceof Error ? error.message : error);
      }
      completedCount += 1;
      reportProgress(group.nodeId, item.suggestedName);
    }

    if (groupSavedCount === 0) {
      await fs.promises.rmdir(folderPath).catch(() => {});
    }
    folderResults.push({
      nodeId: group.nodeId,
      folderPath,
      savedCount: groupSavedCount,
      failedCount: groupFailedCount,
    });
  }

  return { savedCount, failedCount, folders: folderResults };
}

module.exports = {
  exportMediaGroups,
  sanitizeFolderName,
};
