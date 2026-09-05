import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

/**
 * `packages/postgres` の唯一のマイグレーション実行口（ADR 0001・docs/memory-model.md §10「規約」）。
 *
 * ベクトル索引を含むスキーマ全体の DDL は `migrations/*.sql` に手書きで置き、
 * `drizzle-kit push` には一切頼らない。適用順は `readdirSync` のファイル名の
 * 昇順（`0001_`, `0002_`, ... という接頭辞で決める）で固定する。
 *
 * 埋め込み空間ごとのテーブル（`memory_embeddings_<space>`）はここでは作らない。
 * `docs/memory-model.md` §10 が「埋め込み空間を登録する操作の一部としてテーブルを作る」と
 * 書いている通り、空間ごとのテーブルは `registerEmbeddingSpace`（`./vector-space.ts`）が
 * 個別に、しかし同じ「手書きの DDL・drizzle-kit を使わない」という規約の下で作る。
 */

export const DEFAULT_MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

interface AppliedMigration {
  name: string;
}

/**
 * 旧名の台帳 `_mnemo_migrations` を新名 `_mnemora_migrations` へ引き継ぐ。
 *
 * `mnemo` → `mnemora` の改名より前に作られた DB では、適用済みの記録が旧名のテーブルに
 * 入っている。引き継がずに新名の台帳を作ると**空の台帳を読むことになり、
 * `migrations/*.sql` を最初からやり直そうとして落ちる**（`0001_init.sql` の
 * `CREATE TABLE observations` は `IF NOT EXISTS` を付けていない）。
 *
 * 分岐は3つで、いずれも冪等（何度走らせても同じ状態に落ち着く）:
 * - 旧名が在り、新名が無い → RENAME する（引き継ぎが起きるのはこの一度だけ）
 * - 旧名が無い → 何もしない（まっさらな DB・引き継ぎ済みの DB）
 * - 新旧どちらも在る → 何もしない。**新名の台帳を上書きしない**し、旧名のほうも
 *   勝手には消さない——中身の突き合わせは人間の判断に属する
 *
 * **`ensureMigrationsTable` より前に呼ぶこと。**逆順にすると、先に空の
 * `_mnemora_migrations` が出来て「新旧どちらも在る」に落ち、引き継ぎが起きない。
 */
async function handOverLegacyMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    DO $handover$
    BEGIN
      IF to_regclass('_mnemo_migrations') IS NOT NULL
         AND to_regclass('_mnemora_migrations') IS NULL THEN
        ALTER TABLE _mnemo_migrations RENAME TO _mnemora_migrations;
      END IF;
    END
    $handover$;
  `);
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _mnemora_migrations (
      name         text        PRIMARY KEY,
      applied_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
}

function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * 未適用の `migrations/*.sql` を名前の昇順で適用する。適用済みは `_mnemora_migrations` に
 * 記録し、二重適用しない（何度呼んでも安全 = 冪等なマイグレーション実行）。
 *
 * 台帳を読む**前に**、旧名 `_mnemo_migrations` からの引き継ぎを一度通す
 * （`handOverLegacyMigrationsTable`）。
 *
 * `migrationsDir` はテスト用の差し替え口（不正なマイグレーションがロールバックされ、
 * `_mnemora_migrations` に記録されないことを検査するため）。省略時は本番の
 * `migrations/` ディレクトリを使う。
 */
export async function runMigrations(
  pool: Pool,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<{ applied: string[] }> {
  await ensureMigrationsTable(pool);
  await handOverLegacyMigrationsTable(pool);

  const { rows } = await pool.query<AppliedMigration>("SELECT name FROM _mnemora_migrations");
  const alreadyApplied = new Set(rows.map((row) => row.name));

  const applied: string[] = [];
  for (const file of listMigrationFiles(migrationsDir)) {
    if (alreadyApplied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _mnemora_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  return { applied };
}
