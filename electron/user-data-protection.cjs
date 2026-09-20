const fs = require('fs');
const path = require('path');

const BUILD_STATE_FILE = '.magine-build-state.json';
const UPGRADE_BACKUP_DIR = 'upgrade-backups';
const MAX_UPGRADE_BACKUPS = 3;
const UPDATE_SAFETY_DIR = 'update-safety';
const DIRECT_COPY_ENTRIES = [
  'magine-canvas-projects.json',
  'magine-canvas-projects.json.bak',
  'magine-app-settings.json',
  'magine-app-settings.json.bak',
  'Local Storage',
  'IndexedDB',
];
const ROOT_LINK_ENTRIES = [];
const CACHE_COPY_ENTRIES = ['dreamina-profile'];
const CACHE_LINK_ENTRIES = [
  'browser-downloads',
  'dreamina-inputs',
  'dreamina-results',
  'edit-exports',
  'engineering',
  'local-stt',
  'materials',
  'panoramas',
];
const LEGACY_BROWSER_ENTRIES = [
  'blob_storage',
  'IndexedDB',
  'Local State',
  'Local Storage',
  'Network',
  'Partitions',
  'Preferences',
  'Session Storage',
  'WebStorage',
];

function copyTree(source, target, preferHardLinks = false) {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyTree(path.join(source, entry), path.join(target, entry), preferHardLinks);
    }
    return;
  }
  if (!stat.isFile()) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (preferHardLinks) {
    try {
      fs.linkSync(source, target);
      return;
    } catch {
      // Same-volume hard links are preferred; copy is the compatibility fallback.
    }
  }
  fs.copyFileSync(source, target);
}

function mergeTreeMissing(source, target, preferHardLinks = false) {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      mergeTreeMissing(
        path.join(source, entry),
        path.join(target, entry),
        preferHardLinks,
      );
    }
    return;
  }
  if (!stat.isFile() || fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (preferHardLinks) {
    try {
      fs.linkSync(source, target);
      return;
    } catch {
      // Cross-volume install locations fall back to copying.
    }
  }
  fs.copyFileSync(source, target);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeBuildSegment(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function currentBuildId(version, executablePath) {
  try {
    const stat = fs.statSync(executablePath);
    return `${safeBuildSegment(version)}-${stat.size}-${Math.round(stat.mtimeMs)}`;
  } catch {
    return safeBuildSegment(version);
  }
}

function writeJsonAtomicSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function migrateLegacyUserData(targetDir, sourceDirs) {
  const normalizedTarget = path.resolve(targetDir);
  const sources = Array.from(new Set((sourceDirs || [])
    .filter(Boolean)
    .map((source) => path.resolve(source))
    .filter((source) => source !== normalizedTarget && fs.existsSync(source))));
  if (sources.length === 0) return false;

  const markerPath = path.join(targetDir, '.magine-user-data-migration.json');
  const previous = readJsonFile(markerPath);
  if (
    Array.isArray(previous?.sources) &&
    sources.every((source) => previous.sources.includes(source))
  ) {
    return false;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  for (const source of sources) {
    for (const entry of [...DIRECT_COPY_ENTRIES, ...LEGACY_BROWSER_ENTRIES]) {
      mergeTreeMissing(path.join(source, entry), path.join(targetDir, entry));
    }
    for (const entry of ROOT_LINK_ENTRIES) {
      mergeTreeMissing(path.join(source, entry), path.join(targetDir, entry), true);
    }
    const sourceCache = path.join(source, 'magine-cache');
    const targetCache = path.join(targetDir, 'magine-cache');
    for (const entry of CACHE_COPY_ENTRIES) {
      mergeTreeMissing(path.join(sourceCache, entry), path.join(targetCache, entry));
    }
    for (const entry of CACHE_LINK_ENTRIES) {
      mergeTreeMissing(
        path.join(sourceCache, entry),
        path.join(targetCache, entry),
        true,
      );
    }
  }

  writeJsonAtomicSync(markerPath, {
    migratedAt: new Date().toISOString(),
    sources,
  });
  return true;
}

function pruneOldBackups(backupRoot) {
  const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(backupRoot, entry.name),
      mtimeMs: fs.statSync(path.join(backupRoot, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const backup of backups.slice(MAX_UPGRADE_BACKUPS)) {
    fs.rmSync(backup.path, { recursive: true, force: true });
  }
}

function createUpgradeSnapshot(userDataDir, version, previousBuildId, buildId) {
  const backupRoot = path.join(userDataDir, UPGRADE_BACKUP_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(
    backupRoot,
    `${stamp}-${safeBuildSegment(previousBuildId || 'baseline')}`,
  );
  fs.mkdirSync(backupDir, { recursive: true });

  for (const entry of new Set([...DIRECT_COPY_ENTRIES, ...LEGACY_BROWSER_ENTRIES])) {
    copyTree(path.join(userDataDir, entry), path.join(backupDir, entry));
  }
  for (const entry of ROOT_LINK_ENTRIES) {
    copyTree(
      path.join(userDataDir, entry),
      path.join(backupDir, entry),
      true,
    );
  }

  const cacheRoot = path.join(userDataDir, 'magine-cache');
  for (const entry of CACHE_COPY_ENTRIES) {
    copyTree(
      path.join(cacheRoot, entry),
      path.join(backupDir, 'magine-cache', entry),
    );
  }
  for (const entry of CACHE_LINK_ENTRIES) {
    copyTree(
      path.join(cacheRoot, entry),
      path.join(backupDir, 'magine-cache', entry),
      true,
    );
  }

  writeJsonAtomicSync(path.join(backupDir, 'backup-manifest.json'), {
    createdAt: new Date().toISOString(),
    version,
    previousBuildId: previousBuildId || null,
    nextBuildId: buildId,
  });
  pruneOldBackups(backupRoot);
  return backupDir;
}

function recoverInterruptedUpdate(installDir, userDataDir) {
  if (!installDir || !userDataDir) return { recovered: false };
  const preserveRoot = `${path.resolve(installDir)}.__magine-user-data-preserve`;
  const preservedUserData = path.join(preserveRoot, path.basename(userDataDir));
  if (!fs.existsSync(preservedUserData)) return { recovered: false };

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
    fs.renameSync(preservedUserData, userDataDir);
    fs.rmSync(preserveRoot, { recursive: true, force: true });
    return { recovered: true, source: preservedUserData, target: userDataDir };
  }

  mergeTreeMissing(preservedUserData, userDataDir, true);
  return {
    recovered: true,
    source: preservedUserData,
    target: userDataDir,
    preservedCopyRetained: true,
  };
}

function prepareUserDataForUpdate(userDataDir, nextVersion = 'unknown') {
  const backupRoot = path.join(userDataDir, UPDATE_SAFETY_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, `${stamp}-${safeBuildSegment(nextVersion)}`);
  fs.mkdirSync(backupDir, { recursive: true });

  for (const entry of DIRECT_COPY_ENTRIES.slice(0, 4)) {
    copyTree(path.join(userDataDir, entry), path.join(backupDir, entry));
  }
  writeJsonAtomicSync(path.join(backupDir, 'update-manifest.json'), {
    createdAt: new Date().toISOString(),
    nextVersion,
  });
  pruneOldBackups(backupRoot);
  return backupDir;
}

function protectUserDataForCurrentBuild({
  userDataDir,
  version,
  executablePath,
  isPackaged,
  channel = 'default',
}) {
  fs.mkdirSync(userDataDir, { recursive: true });
  if (!isPackaged) return null;

  const installCacheRoot = path.join(path.dirname(executablePath), 'magine-cache');
  const userCacheRoot = path.join(userDataDir, 'magine-cache');
  if (
    path.resolve(installCacheRoot) !== path.resolve(userCacheRoot) &&
    fs.existsSync(installCacheRoot)
  ) {
    mergeTreeMissing(installCacheRoot, userCacheRoot, true);
  }

  const buildId = currentBuildId(version, executablePath);
  const stateFile = channel === 'default'
    ? BUILD_STATE_FILE
    : `${BUILD_STATE_FILE.replace(/\.json$/, '')}-${safeBuildSegment(channel)}.json`;
  const statePath = path.join(userDataDir, stateFile);
  const previous = readJsonFile(statePath);
  if (previous?.buildId === buildId) return null;

  const backupDir = createUpgradeSnapshot(
    userDataDir,
    version,
    typeof previous?.buildId === 'string' ? previous.buildId : '',
    buildId,
  );
  writeJsonAtomicSync(statePath, {
    buildId,
    version,
    protectedAt: new Date().toISOString(),
    latestBackup: backupDir,
  });
  return backupDir;
}

function latestBackupFile(userDataDir, fileName) {
  const backupRoot = path.join(userDataDir, UPGRADE_BACKUP_DIR);
  if (!fs.existsSync(backupRoot)) return null;
  const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupRoot, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const backup of backups) {
    const candidate = path.join(backup, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function readJsonTextWithRecovery(filePath, userDataDir) {
  const candidates = [
    filePath,
    `${filePath}.bak`,
    latestBackupFile(userDataDir, path.basename(filePath)),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const raw = await fs.promises.readFile(candidate, 'utf8');
      JSON.parse(raw);
      return raw;
    } catch {
      // Try the next recovery source.
    }
  }
  return null;
}

async function writeJsonTextAtomic(filePath, text) {
  JSON.parse(text);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${filePath}.bak`;
  await fs.promises.writeFile(tempPath, text, 'utf8');
  let movedPrevious = false;
  try {
    await fs.promises.rm(backupPath, { force: true });
    await fs.promises.rename(filePath, backupPath);
    movedPrevious = true;
  } catch {
    // No previous file on first save.
  }
  try {
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    if (movedPrevious) {
      await fs.promises.copyFile(backupPath, filePath);
    }
    await fs.promises.rm(tempPath, { force: true });
    throw error;
  }
}

module.exports = {
  migrateLegacyUserData,
  prepareUserDataForUpdate,
  protectUserDataForCurrentBuild,
  readJsonTextWithRecovery,
  recoverInterruptedUpdate,
  writeJsonTextAtomic,
};
