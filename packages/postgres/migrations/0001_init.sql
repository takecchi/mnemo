-- 0001_init.sql
--
-- Phase 1 のスキーマ本体（docs/memory-model.md §10）。手書きのマイグレーションとして管理する
-- （ADR 0001・docs/memory-model.md §10「規約」: drizzle-kit push には任せない）。
--
-- Phase 2 のテーブル（memory_relations / labels / memory_labels）はここに含めない。
-- Phase 2 と注記された列（valid_from / valid_until / purged_at）は列としては入れる
-- （docs/memory-model.md がそう指定しているため）。
--
-- 誤り1の修正（このPRで直した箇所）: docs/memory-model.md 原案の
--   CREATE INDEX idx_memories_recall_gate ON memories (tenant_id, status, decay_floor_at)
--     WHERE status = 'active';
-- は、contested な Memory を段1の候補集合からそもそも排除してしまい、
-- 「争われている主張を、争われていない顔で出さない」という原則（mandatory companion
-- retrieval, docs/memory-model.md §5・docs/recall.md §8）を実装として成立させなかった。
-- 述語を WHERE status IN ('active', 'contested') に修正する。
-- 対応する docs の修正は docs/memory-model.md §10 と docs/recall.md §3、
-- および docs/decisions/0011-no-window-count-in-ann-stage.md に記録してある。

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gin;
-- gen_random_uuid() は PostgreSQL 16 以降で標準搭載（docs/memory-model.md §10 前提）。
-- pgcrypto はそれより前のバージョン向けの保険として要求しても害はないため足す。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- observations（Phase 1）
-- ---------------------------------------------------------------------------

CREATE TABLE observations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text        NOT NULL,
  subject_id   text        NULL,
  external_id  text        NULL,
  kind         text        NOT NULL,
  payload      jsonb       NOT NULL,
  occurred_at  timestamptz NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

-- observe() の再送は同じ Observation を返す（冪等性）
CREATE UNIQUE INDEX uq_observations_external_id
  ON observations (tenant_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX idx_observations_by_subject ON observations (tenant_id, subject_id, recorded_at);

-- ---------------------------------------------------------------------------
-- memories（Phase 1。一部列は Phase 2）
-- ---------------------------------------------------------------------------

CREATE TABLE memories (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  subject_id            text        NULL,

  source_observation_id uuid        NULL REFERENCES observations(id),
  extractor_version     text        NULL,

  content               text        NOT NULL,
  content_hash          text        NOT NULL,
  digest                text        NOT NULL,
  digest_source         text        NOT NULL DEFAULT 'llm' CHECK (digest_source IN ('llm','fallback')),

  provenance_kind        text        NOT NULL
                            CHECK (provenance_kind IN ('stated','inferred','consolidated','reflected','imported')),
  provenance              jsonb       NOT NULL,
  CHECK (provenance_kind NOT IN ('stated','inferred') OR source_observation_id IS NOT NULL),

  status                text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','superseded','contested','archived','forgotten')),
  superseded_by_id      uuid        NULL REFERENCES memories(id),
  contested_with_id     uuid        NULL REFERENCES memories(id),

  tags                  text[]      NOT NULL DEFAULT '{}',

  occurred_at           timestamptz NULL,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  last_reinforced_at    timestamptz NULL,
  valid_from            timestamptz NULL,   -- Phase 2
  valid_until           timestamptz NULL,   -- Phase 2

  strength              real        NOT NULL DEFAULT 1.0,
  half_life_hours       real        NOT NULL,
  decay_floor_at        timestamptz NOT NULL,

  embedding_status       text        NOT NULL DEFAULT 'pending'
                            CHECK (embedding_status IN ('pending','ready','failed','skipped')),

  purged_at              timestamptz NULL,   -- Phase 2

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- 抽出の冪等性: 同じ Observation に同じ版の抽出器を再実行しても重複を作らない
CREATE UNIQUE INDEX uq_memories_extraction
  ON memories (tenant_id, source_observation_id, extractor_version, content_hash)
  WHERE source_observation_id IS NOT NULL;

-- recall 段1のゲート（docs/recall.md §3）: tenant + (active|contested) + decay_floor_at の範囲スキャン。
-- 述語は誤り1の修正により 'active' 単独ではなく 'active'/'contested' の両方を含む
-- （contested な Memory も候補集合に入っていなければ mandatory companion retrieval が成立しない）。
-- decay_floor_at は Phase 1 では書き込むだけで読み取りフィルタには使わない（roadmap.md、
-- 誤り3の整理）。索引の3列目としては最初から持つ（Phase 2 で使い始める際に索引を作り直さないため）。
CREATE INDEX idx_memories_recall_gate
  ON memories (tenant_id, status, decay_floor_at)
  WHERE status IN ('active', 'contested');

-- 置換の解決: 「この Memory は何に置き換わったか」の単純な索引アクセス
CREATE INDEX idx_memories_superseded_by
  ON memories (tenant_id, superseded_by_id)
  WHERE superseded_by_id IS NOT NULL;

-- 係争中の Memory の一括検出・companion 取得
CREATE INDEX idx_memories_contested
  ON memories (tenant_id, status)
  WHERE status = 'contested';

-- 第3階の群カウント（recall.md の目次帯）: subject 単位の件数集計
CREATE INDEX idx_memories_by_subject
  ON memories (tenant_id, subject_id, status);

-- provenance によるフィルタ（推論を除外する recall オプション）
CREATE INDEX idx_memories_provenance_kind
  ON memories (tenant_id, provenance_kind);

-- Phase 1: open タグの絞り込み。tenant_id を先頭に含めるため btree_gin を要求する。
CREATE INDEX idx_memories_tags
  ON memories USING gin (tenant_id, tags);

-- ---------------------------------------------------------------------------
-- memory_events（Phase 1、監査ログ。docs/memory-model.md §9）
-- ---------------------------------------------------------------------------

CREATE TABLE memory_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text        NOT NULL,
  memory_id         uuid        NULL REFERENCES memories(id),  -- kind='events_purged' の場合のみ NULL
  kind              text        NOT NULL CHECK (kind IN
                       ('created','updated','superseded','archived','forgotten','purged',
                        'events_purged')),
  at                timestamptz NOT NULL DEFAULT now(),
  actor             jsonb       NOT NULL,   -- { type: 'human'|'system'|'clone', id?: string }
  digest_snapshot   text        NULL,       -- 記録時点の digest。本文(content)は写さない
  size_before_bytes integer     NULL,       -- 削除・置換の直前サイズ
  meta              jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- kind 固有の付帯情報
  CHECK (kind <> 'events_purged' OR memory_id IS NULL)
);

CREATE INDEX idx_memory_events_by_memory ON memory_events (tenant_id, memory_id, at);
CREATE INDEX idx_memory_events_by_kind   ON memory_events (tenant_id, kind, at);

-- ---------------------------------------------------------------------------
-- recalls / recall_usages（Phase 1）
-- ---------------------------------------------------------------------------

CREATE TABLE recalls (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text        NOT NULL,
  subject_id           text        NULL,
  query                jsonb       NOT NULL,             -- 発行された recall クエリ/オプション
  budget               jsonb       NULL,                 -- 申告された予算（recall.md §6）
  omitted              jsonb       NOT NULL DEFAULT '[]', -- Omission[] のスナップショット
  usage                jsonb       NOT NULL,              -- RecallUsage のスナップショット
  index_band           jsonb       NOT NULL,              -- 第3階の群カウント（目次帯）
  explain              jsonb       NOT NULL DEFAULT '{}', -- 各段の実行/未実行トレース
  returned_memory_ids  uuid[]      NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recalls_by_subject ON recalls (tenant_id, subject_id, created_at);

CREATE TABLE recall_usages (
  tenant_id  text        NOT NULL,
  recall_id  uuid        NOT NULL REFERENCES recalls(id),
  memory_id  uuid        NOT NULL REFERENCES memories(id),
  used_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, recall_id, memory_id)
);

-- ---------------------------------------------------------------------------
-- outbox（Phase 1）
-- ---------------------------------------------------------------------------

CREATE TABLE outbox (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  kind          text        NOT NULL,      -- 'extract' | 'embed' | 'consolidate' | 'reflect' | ...
  payload       jsonb       NOT NULL,
  available_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz NULL,
  claimed_by    text        NULL,
  attempts      integer     NOT NULL DEFAULT 0,
  completed_at  timestamptz NULL,
  failed_at     timestamptz NULL,
  last_error    text        NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ワーカーの claim クエリ: 未着手・未完了のジョブを available_at 昇順で取得
CREATE INDEX idx_outbox_pending
  ON outbox (tenant_id, kind, available_at)
  WHERE completed_at IS NULL AND claimed_at IS NULL;

-- ---------------------------------------------------------------------------
-- tenant_settings（Phase 1）
-- ---------------------------------------------------------------------------

CREATE TABLE tenant_settings (
  tenant_id                text        PRIMARY KEY,
  default_half_life_hours  real        NOT NULL DEFAULT 720,   -- 30日。Memory 作成時の既定値
  event_retention_days     integer     NULL,                    -- NULL = 無期限
  taxonomy_mode            text        NOT NULL DEFAULT 'open' CHECK (taxonomy_mode IN ('open','strict')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
