import { cpSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
if (process.platform !== 'win32') throw new Error('Windows desktop installers must be built on Windows x64.');
if (process.arch !== 'x64') throw new Error('Use 64-bit Node.js to build the Windows installer.');
const sourceNode = process.execPath;
if (!sourceNode.toLowerCase().endsWith('node.exe') || !existsSync(sourceNode)) throw new Error('A real Windows node.exe is required for bundling.');

const stage = path.join(root, 'dist', 'desktop-runtime');
const paths = ['dist/server/wrangler.json', 'dist/server/index.js', 'dist/client', 'drizzle', 'node_modules/wrangler/bin/wrangler.js'];
for (const item of paths) if (!existsSync(path.join(root, item))) throw new Error(`Desktop packaging prerequisite missing: ${item}`);

if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, 'node'), { recursive: true });
copyFileSync(sourceNode, path.join(stage, 'node', 'node.exe'));
cpSync(path.join(root, 'dist', 'server'), path.join(stage, 'dist', 'server'), { recursive: true });
cpSync(path.join(root, 'dist', 'client'), path.join(stage, 'dist', 'client'), { recursive: true });
cpSync(path.join(root, 'drizzle'), path.join(stage, 'drizzle'), { recursive: true });

// Wrangler/Miniflare uses platform-specific workerd binaries. Preserve the
// complete installed dependency tree for this first working installer.
// Optimization to a pruned runtime can follow verified Windows smoke tests.
cpSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true, dereference: false, filter: source => !source.includes(`${path.sep}.cache${path.sep}`) });

const nodeSize = statSync(path.join(stage, 'node', 'node.exe')).size;
if (nodeSize < 1_000_000) throw new Error('Bundled Node.js executable looks incomplete.');
console.log('Windows runtime staged. Users will not need Node.js installed.');
console.log(`Staged runtime: ${stage}`);
