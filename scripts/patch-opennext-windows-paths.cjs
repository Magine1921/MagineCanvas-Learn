const fs = require('fs');
const path = require('path');

const pluginPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@opennextjs',
  'cloudflare',
  'dist',
  'cli',
  'build',
  'patches',
  'plugins',
  'turbopack.js',
);

const marker = 'const file = originalFile.replaceAll("\\\\", "/");';
const copiedPackageMarker = "const packageJsonPath = path.join(nodeModulesDir, entry.name, 'package.json');";
const originalModulesMarker = "const originalNodeModulesDir = path.join(process.cwd(), '.next', 'node_modules');";
let source = fs.readFileSync(pluginPath, 'utf8');

if (!source.includes(marker)) {
  source = source.replace(
    'for (const file of tracedFiles) {\n        if (file === "[turbopack]_runtime.js") {',
    `for (const originalFile of tracedFiles) {\n        const file = originalFile.replaceAll("\\\\", "/");\n        if (file === "[turbopack]_runtime.js") {`,
  );
  fs.writeFileSync(pluginPath, source);
}

if (!source.includes(originalModulesMarker)) {
  source = source.replace(
    `    const nodeModulesDir = path.join(dotNextDir, "node_modules");\n    const mappings = new Map();\n    if (!fs.existsSync(nodeModulesDir)) {\n        return mappings;\n    }`,
    `    const tracedNodeModulesDir = path.join(dotNextDir, "node_modules");\n    const originalNodeModulesDir = path.join(process.cwd(), '.next', 'node_modules');\n    const nodeModulesDir = fs.existsSync(tracedNodeModulesDir)\n        ? tracedNodeModulesDir\n        : originalNodeModulesDir;\n    const mappings = new Map();\n    if (!fs.existsSync(nodeModulesDir)) {\n        return mappings;\n    }`,
  );
  fs.writeFileSync(pluginPath, source);
}

if (!source.includes(copiedPackageMarker)) {
  source = source.replace(
    `                if (match?.[1]) {\n                    mappings.set(entry.name, match[1]);\n                }\n            }\n        }\n        catch {`,
    `                if (match?.[1]) {\n                    mappings.set(entry.name, match[1]);\n                }\n            }\n            else if (entry.isDirectory()) {\n                const packageJsonPath = path.join(nodeModulesDir, entry.name, 'package.json');\n                if (fs.existsSync(packageJsonPath)) {\n                    const packageName = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).name;\n                    if (packageName) mappings.set(entry.name, packageName);\n                }\n            }\n        }\n        catch {`,
  );
  fs.writeFileSync(pluginPath, source);
}

console.log('[cloudflare-build] Normalized OpenNext Turbopack paths for Windows.');
