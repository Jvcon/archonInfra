#!/usr/bin/env node
/**
 * D1 数据库快照导出脚本
 *
 * 用法：
 *   本地模式（读 wrangler 本地 SQLite）：
 *     node scripts/export-snapshot.mjs
 *     node scripts/export-snapshot.mjs --local
 *
 *   远程模式（通过 wrangler d1 execute --remote 查询）：
 *     node scripts/export-snapshot.mjs --remote
 *
 *   指定输出文件：
 *     node scripts/export-snapshot.mjs --out snapshots/2024-01-01.json
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 所有需要导出的表（按依赖顺序排列）
const TABLES = [
  'entities',
  'vlans',
  'subnets',
  'ip_addresses',
  'network_interfaces',
  'switch_ports',
  'switch_port_vlans',
  'edges',
  'wifi_ssids',
  'logical_interfaces',
  'firewall_zones',
  'vlan_policies',
  'static_routes',
  'nat_rules',
];

// 解析命令行参数
const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const outIdx = args.indexOf('--out');
const outArg = outIdx !== -1 ? args[outIdx + 1] : null;

// 输出文件路径
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const defaultOut = join(ROOT, 'snapshots', `snapshot-${timestamp}.json`);
const outFile = outArg ? join(ROOT, outArg) : defaultOut;

// ─────────────────────────────────────────────
// 本地模式：直接用 node:sqlite 读 wrangler SQLite
// ─────────────────────────────────────────────
function findLocalDb() {
  // wrangler v3 本地 D1 路径：.wrangler/state/v3/d1/<uuid>/db.sqlite
  const d1Dir = join(ROOT, '.wrangler', 'state', 'v3', 'd1');
  if (!existsSync(d1Dir)) {
    throw new Error(
      `找不到本地 D1 目录：${d1Dir}\n` +
      '请先运行 pnpm run dev:worker 或 pnpm run db:migrate 生成本地数据库'
    );
  }
  // 找到第一个包含 db.sqlite 的子目录
  const entries = readdirSync(d1Dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const candidate = join(d1Dir, entry.name, 'db.sqlite');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`在 ${d1Dir} 下未找到 db.sqlite，请确保本地数据库已初始化`);
}

async function exportLocal() {
  const dbPath = findLocalDb();
  console.log(`📂 读取本地数据库：${dbPath}`);

  // node:sqlite 在 Node.js 22.5+ 可用
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { open: true });

  const snapshot = {
    _meta: {
      exportedAt: new Date().toISOString(),
      mode: 'local',
      dbPath,
    },
  };

  for (const table of TABLES) {
    try {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      snapshot[table] = rows;
      console.log(`  ✓ ${table}: ${rows.length} 行`);
    } catch (err) {
      console.warn(`  ⚠ ${table}: 跳过（${err.message}）`);
      snapshot[table] = [];
    }
  }

  db.close();
  return snapshot;
}

// ─────────────────────────────────────────────
// 远程模式：通过 wrangler d1 execute --remote
// ─────────────────────────────────────────────
function execWranglerQuery(sql) {
  // wrangler d1 execute <db-name> --remote --command <sql> --json
  const cmd = `npx wrangler d1 execute archon-infra --remote --command ${JSON.stringify(sql)} --json`;
  try {
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    // wrangler --json 输出格式：[{ results: [...], ... }]
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? (parsed[0]?.results ?? []) : [];
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    throw new Error(`wrangler 查询失败：${stderr || err.message}`);
  }
}

async function exportRemote() {
  console.log('🌐 通过 wrangler d1 execute --remote 查询远程数据库');

  const snapshot = {
    _meta: {
      exportedAt: new Date().toISOString(),
      mode: 'remote',
      database: 'archon-infra',
    },
  };

  for (const table of TABLES) {
    try {
      const rows = execWranglerQuery(`SELECT * FROM ${table}`);
      snapshot[table] = rows;
      console.log(`  ✓ ${table}: ${rows.length} 行`);
    } catch (err) {
      console.warn(`  ⚠ ${table}: 跳过（${err.message}）`);
      snapshot[table] = [];
    }
  }

  return snapshot;
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
async function main() {
  console.log(`\n🗄️  ArchonInfra D1 快照导出`);
  console.log(`   模式：${isRemote ? '远程 (--remote)' : '本地 (--local)'}`);
  console.log(`   输出：${outFile}\n`);

  // 确保输出目录存在
  const outDir = dirname(outFile);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  let snapshot;
  if (isRemote) {
    snapshot = await exportRemote();
  } else {
    snapshot = await exportLocal();
  }

  // 写入 JSON
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf-8');

  const totalRows = TABLES.reduce((sum, t) => sum + (snapshot[t]?.length ?? 0), 0);
  console.log(`\n✅ 导出完成：共 ${totalRows} 行数据 → ${outFile}`);
}

main().catch((err) => {
  console.error('\n❌ 导出失败：', err.message);
  process.exit(1);
});
