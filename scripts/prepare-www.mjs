import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'www');

const RUNTIME_FILES = [
    'index.html',
    'style.css',
    'config.js',
    'db.js',
    'manifest.json',
    'sw.js'
];

const RUNTIME_DIRS = [
    'js',
    'icons'
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of RUNTIME_FILES) {
    const src = path.join(rootDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(outDir, file));
    }
}

for (const dir of RUNTIME_DIRS) {
    const src = path.join(rootDir, dir);
    if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(outDir, dir), { recursive: true });
    }
}

console.log('[prepare-www] Copied web assets into www/');
