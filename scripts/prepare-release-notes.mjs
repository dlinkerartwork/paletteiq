import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
const entries = [...changelog.matchAll(/^## \[([^\]]+)\](?:\s+-\s+[^\n]+)?\s*$/gm)];
const current = entries.find((entry) => entry[1] === version);
if (!current) {
  throw new Error(`Missing CHANGELOG.md entry for desktop version ${version}. Add "## [${version}] - YYYY-MM-DD" before packaging.`);
}
const start = current.index + current[0].length;
const next = entries.find((entry) => entry.index > current.index);
const body = changelog.slice(start, next?.index ?? changelog.length).trim();
if (body.length < 80 || !/^###\s+/m.test(body)) {
  throw new Error(`Release notes for ${version} are incomplete. Add section headings and meaningful update details.`);
}
const notes = `# PaletteIQ Desktop v${version} — Release Notes\n\n${body}\n\n---\n\nDokumentasi riwayat seluruh versi tersedia dalam CHANGELOG.md di repositori.\n`;
const releaseDir = path.join(root, 'release');
const runtimeDir = path.join(root, 'dist', 'desktop-runtime');
await mkdir(releaseDir, { recursive: true });
await mkdir(runtimeDir, { recursive: true });
const releasePath = path.join(releaseDir, `PaletteIQ-Release-Notes-${version}.md`);
await writeFile(releasePath, notes, 'utf8');
await writeFile(path.join(runtimeDir, 'RELEASE_NOTES.md'), notes, 'utf8');
await copyFile(path.join(root, 'CHANGELOG.md'), path.join(runtimeDir, 'CHANGELOG.md'));
console.log(`Desktop release notes prepared: ${releasePath}`);
