import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const serviceWorkerPath = resolve(
  process.argv[2] ?? 'build/web/flutter_service_worker.js',
);

const offlineVideos = [
  'assets/assets/offline_videos/call_115.mp4',
  'assets/assets/offline_videos/scene_safety.mp4',
  'assets/assets/offline_videos/observe_signs.mp4',
  'assets/assets/offline_videos/wait_for_support.mp4',
];

let source = await readFile(serviceWorkerPath, 'utf8');
const match = source.match(/const CORE = \[(.*?)\];/s);
if (!match) {
  throw new Error(`Khong tim thay CORE trong ${serviceWorkerPath}`);
}

const additions = offlineVideos
  .filter((path) => !match[1].includes(JSON.stringify(path)))
  .map((path) => `  ${JSON.stringify(path)},`)
  .join('\n');

if (additions.length > 0) {
  const existing = match[1].trimEnd();
  const separator = existing.endsWith(',') ? '' : ',';
  const updatedCore = `const CORE = [${existing}${separator}\n${additions}\n];`;
  source = source.replace(match[0], updatedCore);
  await writeFile(serviceWorkerPath, source, 'utf8');
}

for (const path of offlineVideos) {
  if (!source.includes(JSON.stringify(path))) {
    throw new Error(`Video chua duoc precache: ${path}`);
  }
}

process.stdout.write(`Da precache ${offlineVideos.length} video offline.\n`);
