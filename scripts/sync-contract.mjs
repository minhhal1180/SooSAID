#!/usr/bin/env node
/**
 * Sao chép contract dùng chung (packages/api-contract) sang từng app.
 *
 * Lý do không dùng TS path alias/monorepo package thật: NestJS (`nest build`,
 * rootDir=src) và Next.js có hai cách resolve khác nhau cho code ngoài thư mục
 * app. Sao chép có kiểm soát giữ đúng "một nguồn sự thật" mà không phải cấu hình
 * build phức tạp cho một MVP.
 *
 * Chạy: npm run sync:contract
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(repoRoot, 'packages', 'api-contract', 'src', 'index.ts');

const TARGETS = [
  join(repoRoot, 'apps', 'api', 'src', 'contracts', 'generated', 'api-contract.ts'),
  join(repoRoot, 'apps', 'operator-web', 'src', 'contracts', 'generated', 'api-contract.ts'),
];

const BANNER = `/* eslint-disable */
// =============================================================================
// FILE ĐƯỢC SINH TỰ ĐỘNG – KHÔNG SỬA TRỰC TIẾP.
// Nguồn: packages/api-contract/src/index.ts
// Sinh lại bằng: npm run sync:contract
// =============================================================================

`;

const source = readFileSync(SOURCE, 'utf8');

for (const target of TARGETS) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, BANNER + source, 'utf8');
  console.log(`[sync-contract] ${target.replace(repoRoot, '.')}`);
}

console.log(`[sync-contract] Đã đồng bộ contract sang ${TARGETS.length} app.`);
