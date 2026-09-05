# Architecture Decision Records

mnemora の設計判断のうち、**後から見て「なぜそうしたか」を追える形で残す必要があるもの**を
ADR (Architecture Decision Record) として記録する。`docs/architecture.md` や
`docs/memory-model.md` 等の他の docs が「何がどう決まっているか」を記述するのに対し、
ここでは各決定について、検討した選択肢・却下した理由・引き受ける負債・覆る条件までを
1ファイルにまとめる。**決定そのものをやり直す場ではなく、決定を記録する場である。**

alteroid (github.com/takecchi/alteroid) を根拠として引く箇所は、確認済み/未確認を分けた
一次調査の記録である [docs/alteroid-findings.md](../alteroid-findings.md) を参照する。

## 一覧

| 番号 | 題 | 状態 |
|---|---|---|
| [0001](./0001-orm-drizzle.md) | ORM は Drizzle | 採用 (2026-09) |
| [0002](./0002-embedding-space-tables.md) | pgvector の抽象と埋め込み空間ごとのテーブル分割 | 採用 (2026-09) |
| [0003](./0003-memorystore-vs-vectorstore.md) | MemoryStore と VectorStore を分けるか | 採用 (2026-09) |
| [0004](./0004-decay-at-query-time.md) | 忘却をクエリ時に算出しつつ ANN 索引を殺さない | 採用 (2026-09) |
| [0005](./0005-job-queue-abstraction.md) | Job Queue の抽象 | 採用 (2026-09) |
| [0006](./0006-memory-schema.md) | Memory schema の設計判断 | 採用 (2026-09) |
| [0007](./0007-tenant-scoping.md) | Tenant scoping | 採用 (2026-09) |
| [0008](./0008-absence-taxonomy.md) | 「無い」を分類して返す | 採用 (2026-09) |
| [0009](./0009-usage-feedback-via-observe.md) | 使用フィードバックを observe() で受ける | 採用 (2026-09) |
| [0010](./0010-decay-parameters.md) | 減衰の式とパラメータを固定する | 採用 (2026-09) |
| [0011](./0011-no-window-count-in-ann-stage.md) | 段1の ANN クエリに `count(*) OVER ()` を入れない | 採用 (2026-09) |
| [0012](./0012-ingest-pipeline-design.md) | 取り込みパイプライン（`observe()` / `runtime.tick()`）の実装方針 | 採用 (2026-09) |
| [0013](./0013-extraction-outcome-taxonomy.md) | 抽出の失敗を、成功と同じ顔で記録しない | 採用 (2026-09) |
| [0014](./0014-package-name-mnemora.md) | 名前を `mnemora` / `@mnemora/*` に確定する | 採用 (2026-09) |
