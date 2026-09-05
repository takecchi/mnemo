import { defaultDecayStrategy } from "@mnemo/core";
import type { NewMemory, NewMemoryEvent, NewObservation } from "@mnemo/core";

/**
 * 適合テスト（および testkit 自身の自己テスト）で使う、妥当な `NewMemory` のひな型。
 * 実際の adapter 実装向けではなく、テストデータの生成専用。
 */
export function buildNewMemoryFixture(overrides: Partial<NewMemory> = {}): NewMemory {
  const recordedAt = overrides.recordedAt ?? new Date("2026-01-01T00:00:00.000Z");
  const strength = overrides.strength ?? 1;
  const halfLifeHours = overrides.halfLifeHours ?? 720;
  const base: NewMemory = {
    tenantId: "tenant-1",
    subjectId: null,
    sourceObservationId: null,
    extractorVersion: null,
    content: "テスト用の本文",
    contentHash: "fixture-hash-1",
    digest: "テスト用の要旨",
    digestSource: "llm",
    provenance: { kind: "imported", batchId: "fixture-batch" },
    tags: [],
    occurredAt: null,
    recordedAt,
    lastReinforcedAt: null,
    strength,
    halfLifeHours,
    decayFloorAt: defaultDecayStrategy.floorAt({
      recordedAt,
      lastReinforcedAt: null,
      strength,
      halfLifeHours,
    }),
    embeddingStatus: "pending",
  };
  return { ...base, ...overrides };
}

export function buildNewObservationFixture(
  overrides: Partial<NewObservation> = {},
): NewObservation {
  return {
    tenantId: "tenant-1",
    subjectId: null,
    externalId: null,
    kind: "utterance",
    payload: { text: "テスト用の発話" },
    occurredAt: null,
    ...overrides,
  };
}

/**
 * `memoryId` の既定は `null` にする。docs/memory-model.md §9 の DDL では
 * `memory_events.memory_id` が `memories(id)` への外部キーであり（`events_purged` の場合のみ
 * NULL、という制約はあるが、それ以外の kind で NULL であること自体は妨げない）、実在しない
 * `memories` 行を指す固定文字列を既定値にすると、外部キー制約を持つ実装（`packages/postgres`）
 * に対して常に失敗する。「実在する Memory に紐づく監査ログ」を検査したいテストは
 * `EventStoreConformanceOptions.prepareMemoryId`（adapter が実在の Memory を用意して id を
 * 返すフック）を使う。
 */
export function buildNewMemoryEventFixture(
  overrides: Partial<NewMemoryEvent> = {},
): NewMemoryEvent {
  return {
    tenantId: "tenant-1",
    memoryId: null,
    kind: "created",
    actor: { type: "system" },
    digestSnapshot: null,
    sizeBeforeBytes: null,
    meta: {},
    ...overrides,
  };
}
