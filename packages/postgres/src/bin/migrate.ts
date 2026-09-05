#!/usr/bin/env node
import { Pool } from "pg";
import { runMigrations } from "../migrate.js";

/**
 * CLI エントリポイント。`DATABASE_URL` を読み、保留中のマイグレーションを適用する。
 *
 * 他パッケージやルートから直接 drizzle-kit を叩かせない、という ADR 0001 の規約により、
 * マイグレーションの実行はこの1つの口からのみ行う。
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL が設定されていません。");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    const { applied } = await runMigrations(pool);
    if (applied.length === 0) {
      console.log("適用対象のマイグレーションはありません（すべて適用済み）。");
    } else {
      console.log(`適用したマイグレーション: ${applied.join(", ")}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
