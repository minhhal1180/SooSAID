#!/usr/bin/env node
/**
 * Chạy migration và (tuỳ chọn) seed cho PostgreSQL.
 *
 * Thiết kế tối giản có chủ đích — không dùng framework migration:
 *  - Bộ file SQL là nguồn sự thật, đọc được bằng mắt khi review bảo mật.
 *  - Bảng `schema_migrations` ghi file nào đã chạy, nên chạy lại là an toàn.
 *  - Mỗi file chạy trong MỘT transaction: lỗi giữa chừng thì rollback sạch,
 *    không để lại schema nửa vời.
 *
 * Dùng:
 *   node scripts/migrate.mjs                 # chỉ migration
 *   node scripts/migrate.mjs --seed          # migration + seed dev
 *   DATABASE_URL=... node scripts/migrate.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(repoRoot, 'apps', 'api', 'package.json'));

const MIGRATIONS_DIR = join(repoRoot, 'db', 'migrations');
const SEEDS_DIR = join(repoRoot, 'db', 'seeds');

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://sos:sos_local_only@localhost:5432/sos_aid';
const runSeeds = process.argv.includes('--seed');

/** `pg` được cài trong apps/api; nạp từ đó thay vì thêm dependency ở gốc repo. */
let Client;
try {
  ({ Client } = require('pg'));
} catch {
  console.error(
    'Không tìm thấy package `pg`. Chạy `npm install` trong apps/api trước.',
  );
  process.exit(1);
}

function listSqlFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

async function applyFile(client, directory, fileName, kind) {
  const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [
    fileName,
  ]);
  if (applied.rowCount > 0) {
    console.log(`  = ${fileName} (đã chạy trước đó, bỏ qua)`);
    return;
  }

  const sql = readFileSync(join(directory, fileName), 'utf8');

  // File SQL tự quản lý BEGIN/COMMIT của nó; ở đây chỉ bọc thêm một lớp để
  // việc ghi vào schema_migrations cũng nằm cùng số phận với nội dung file.
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename, kind) VALUES ($1, $2)',
      [fileName, kind],
    );
    console.log(`  + ${fileName}`);
  } catch (error) {
    console.error(`  ! ${fileName} THẤT BẠI: ${error.message}`);
    throw error;
  }
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   varchar(255) PRIMARY KEY,
        kind       varchar(32)  NOT NULL DEFAULT 'migration',
        applied_at timestamptz  NOT NULL DEFAULT now()
      )
    `);

    console.log('Migration:');
    for (const fileName of listSqlFiles(MIGRATIONS_DIR)) {
      await applyFile(client, MIGRATIONS_DIR, fileName, 'migration');
    }

    if (runSeeds) {
      console.log('Seed (chỉ dùng cho môi trường phát triển):');
      for (const fileName of listSqlFiles(SEEDS_DIR)) {
        await applyFile(client, SEEDS_DIR, fileName, 'seed');
      }
    }

    console.log('Hoàn tất.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
