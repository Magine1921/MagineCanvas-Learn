const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '.next');

function materializeLinks(directory) {
  if (!fs.existsSync(directory)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      const source = fs.realpathSync(filePath);
      const temp = `${filePath}.magine-copy`;
      fs.rmSync(temp, { recursive: true, force: true });
      fs.cpSync(source, temp, { recursive: true });
      fs.rmSync(filePath, { recursive: true, force: true });
      fs.renameSync(temp, filePath);
      count += 1;
      continue;
    }
    if (stat.isDirectory()) {
      count += materializeLinks(filePath);
    }
  }
  return count;
}

function includeTurbopackDependenciesInTraces(directory) {
  if (!fs.existsSync(directory)) return 0;

  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      count += includeTurbopackDependenciesInTraces(filePath);
      continue;
    }
    if (!entry.name.endsWith('.js.nft.json')) continue;

    const modulePath = filePath.slice(0, -'.nft.json'.length);
    if (!fs.existsSync(modulePath)) continue;

    const trace = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(trace.files)) continue;

    const dependencies = new Set();
    const queue = [modulePath];
    for (const tracedFile of trace.files) {
      queue.push(path.resolve(path.dirname(modulePath), tracedFile));
    }

    const visited = new Set();
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate || visited.has(candidate) || !fs.existsSync(candidate)) continue;
      visited.add(candidate);
      if (!candidate.endsWith('.js')) continue;

      const code = fs.readFileSync(candidate, 'utf8');
      const addDependencyPath = (dependencyPath) => {
        const dependency = path.relative(path.dirname(modulePath), dependencyPath).replaceAll('\\', '/');
        dependencies.add(dependency);
        queue.push(dependencyPath);
      };

      const runtimeMatch = code.match(/require\(["']([^"']*\[turbopack\]_runtime\.js)["']\)/);
      if (runtimeMatch?.[1]) {
        addDependencyPath(path.resolve(path.dirname(candidate), runtimeMatch[1]));
      }

      for (const match of code.matchAll(/R\.c\(["']([^"']+)["']\)/g)) {
        addDependencyPath(path.join(root, match[1]));
      }
      for (const match of code.matchAll(/["'](server\/chunks\/[^"']+\.js)["']/g)) {
        addDependencyPath(path.join(root, match[1]));
      }
    }

    let changed = false;
    for (const dependency of dependencies) {
      if (trace.files.includes(dependency)) continue;
      trace.files.push(dependency);
      changed = true;
    }
    if (!changed) continue;

    fs.writeFileSync(filePath, JSON.stringify(trace));
    count += 1;
  }
  return count;
}

const count = materializeLinks(root);
const updatedTraces = includeTurbopackDependenciesInTraces(path.join(root, 'server'));
const sourceChunks = path.join(root, 'server', 'chunks');
const standaloneChunks = path.join(root, 'standalone', '.next', 'server', 'chunks');

if (fs.existsSync(sourceChunks)) {
  fs.mkdirSync(standaloneChunks, { recursive: true });
  fs.cpSync(sourceChunks, standaloneChunks, { recursive: true });
}

console.log(`[cloudflare-build] Materialized ${count} traced dependency links.`);
console.log(`[cloudflare-build] Added Turbopack dependencies to ${updatedTraces} route traces.`);
console.log('[cloudflare-build] Copied Next.js runtime chunks into standalone output.');
