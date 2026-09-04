# architecture

対象読者: オーナー（takecchi）とそのクローン。設計判断の記録であって入門資料ではない。
用語の定義は [docs/vision.md](./vision.md)、記憶モデルの詳細は [docs/memory-model.md](./memory-model.md)、
recall の詳細は [docs/recall.md](./recall.md)、フェーズ計画は [docs/roadmap.md](./roadmap.md)、
個別の決定理由は [docs/decisions/](./decisions/) を見ること。この doc は「何がどう決まっているか」を書く。

---

## 0. 設計を貫く一本の原則

**文脈を剥がして提示しない (Qualified Presentation)。**

これは mnemo のどの機能よりも先にある規律で、三つの姿で現れる。

1. **争われている主張は、それを争う相手と必ず同時に提示する**（矛盾の扱い）
2. **推論は、その根拠と必ず同時に提示する**（provenance）
3. **結果は、そこから漏れたものと必ず同時に提示する**（explainability / 不在の分類）

この三つは別々の機能一覧ではない。**同じ一つの規律**が、矛盾・推論・欠落という三つの適用先に
現れているだけである。以降の各節に出てくる `omitted`・`contested`・`provenance.basis`・
`embeddingStatus`・`counter: 'heuristic' | 'exact'` は、すべてこの一本の規律の実装である。
節ごとにどの姿の適用かを一行で示す。

---

## 3. 全体アーキテクチャ

### 3.1 層

mnemo は既存の LLM アプリケーションの**下に敷く**認知レイヤーであり、エージェントフレームワークの
代替ではない。

```
┌───────────────────────────────────────────────┐
│ Application                                    │
├───────────────────────────────────────────────┤
│ Agent / LLM フレームワーク（LangGraph, Mastra, 自作 …） │
├───────────────────────────────────────────────┤
│ mnemo Cognitive Runtime                        │  ← mnemo はここ
│   observe / recall / reflect                   │
│   consolidate / forget                         │
├───────────────────────────────────────────────┤
│ Storage（Postgres）│ LLM（OpenAI/Anthropic）│ Queue（BullMQ）│
└───────────────────────────────────────────────┘
```

Application と Agent/LLM は mnemo の**利用側**であり、mnemo が知る必要はない。mnemo が知るのは
Runtime とその下（Storage / LLM / Queue の interface）だけである。プロンプトの組み立ては呼び出し側の
責務であり mnemo は行わない（この限界は [docs/recall.md](./recall.md) で詳説）。

### 3.2 Runtime 内部 — 5 つの動詞がどこを通るか

API 表面は 5 動詞に固定する（6 つ目を足さない。理由は [docs/decisions/](./decisions/) の ADR）。
それぞれが Runtime 内部でどの部品を通るかで分類する。

**書き込み系 — `observe(ctx, input)`**

```
observe
  → MemoryStore.append(Observation)        ── 同一トランザクションで
  → outbox テーブルへ抽出ジョブを書く         ── │ 同一トランザクションで（§3.4）
  → [extract: 'sync']     その場で LLMProvider 抽出 → MemoryStore.create(Memory)
  → [extract: 'deferred'] ここで終わる。抽出は後で Scheduler 経由（§3.3）
```

**読み出し系 — `recall(ctx, query)`**

```
recall
  → EmbeddingProvider.embed(query)
  → VectorStore.search()      ── 段1: ANN + 索引が効くフィルタのみ（tenant/status/decay_floor_at）
  → ScoringStrategy(...)      ── 段2: 純関数で over-fetch 分を再スコア
  → MemoryStore                ── contested の対向を mandatory companion retrieval
  → recalls / recall_usages を記録（後述 §3.5・[docs/recall.md](./recall.md)）
  → RecallResult { memories, omitted, index, usage, explain }
```

recall が「返ったもの」と「返らなかったもの」を対等に返す構造そのものが、原則の姿3の実装である
（詳細は [docs/recall.md](./recall.md)）。

**背景系 — `reflect(ctx, opts)` / `consolidate(ctx, opts)`**

```
reflect / consolidate
  → Scheduler が起動（または runtime.tick() が明示的に駆動）
  → LLMProvider.completeStructured(...)   ── provenance.kind = 'reflected' | 'consolidated'
  → MemoryStore.create(Memory)
  → EventStore.append
```

**破棄系 — `forget(ctx, target)`**

```
forget
  → MemoryStore.updateStatus(status: 'forgotten')  ── 同一トランザクションで
  → EventStore.append                               ── │ 同一トランザクションで（「必ず残る」の強制）
```

`purge()`（物理削除）は Phase 2 以降。イベント種別だけは Phase 1 のスキーマに含める。

### 3.3 Background Cognition を切っても成立する

`Scheduler` interface を切り、既定実装は **`InlineScheduler`**（キューを持たず、呼び出しの中で
即時実行する）。これにより Redis も BullMQ も無い最小構成が最初から成立する。

`observe()` は `extract: 'sync' | 'deferred'` を受ける。`sync` は observe の応答が遅くなる代わりに
その場で記憶になる。`deferred` は observe が速く返る代わりに、抽出が終わるまで recall に乗らない。
**どちらを既定にするかはオーナーの判断が必要**（[docs/roadmap.md](./roadmap.md) の「設計上まだ判断が必要な点」に残す。製品の性格を決める選択であり、
このドキュメントで先取りしない）。

`deferred` を選び、かつ Scheduler が `InlineScheduler`（キュー無し）の構成では、誰かが実際に
CPU を出して溜まったジョブを消化する必要がある。この継ぎ目を隠さず **`runtime.tick(ctx, opts)`**
として明示的に露出する。cron や手動呼び出しから叩ける形にする。「キューが無ければ黙って何も起きない」
という状態を作らない——これも姿3（漏れを黙って無かったことにしない）の適用である。

### 3.4 transactional outbox

`observe()` の DB コミットと「抽出ジョブを積む」は同一トランザクションでなければならない。
DB のトランザクションの中から Redis（BullMQ）へ直接書くと、コミットとエンキューが分離するため
at-least-once が壊れる（DB がコミットされたのにジョブが飛ばない、または DB がロールバックしたのに
ジョブだけ残る、のどちらかが起こり得る）。

そのため `observe()` は抽出ジョブを **`outbox` テーブル**へ書く。実際のキューへは別の運搬役
（relay）が outbox の未処理行を読んで渡す。`deferred` を Phase 1 に持つ以上、outbox も Phase 1 の
成果物に含める。運搬役の実装がまだ `InlineScheduler` だけであっても、outbox というテーブルと
書き込み契約自体は最初から要る。

### 3.5 冪等

再送・二重配信は前提として設計する。**カウンタの盲目的インクリメントを設計原則として禁止する。**
値を直接足すのではなく、一意制約を持つ行の挿入が「実際に起きたか」で数える。

| 対象 | 冪等キー | 挙動 |
|---|---|---|
| Observation | `externalId`（テナント内一意, 任意） | 再送は同じ Observation を返す |
| 抽出 → Memory | `(observationId, extractorVersion)` | `(tenant_id, source_observation_id, extractor_version, content_hash)` に一意制約 |
| 使用報告 | `(recall_id, memory_id)` | 主キー。再送は挿入が弾かれるだけ。`last_reinforced_at` / `strength` は挿入が実際に起きたときだけ更新する |

この対応表が示す通り、**「使われたかどうか」は行の存在で表現する**。カラムを+1するのではない。

### 3.6 core は Infrastructure から独立している

`packages/core` が実行時に依存してよいのは **zod だけ**である。DB クライアント、LLM SDK、
キュークライアントのいずれも `core` の `package.json` の `dependencies` に現れない。これは
方針ではなく `packages/testkit` の CI チェックと `package.json` の lint（禁止依存の静的検査）で
機械的に担保する。core が知ってよいのは interface（この doc の §5）と純関数の戦略（`ScoringStrategy` /
`DecayStrategy`）だけであり、実体（Postgres・OpenAI・BullMQ）は adapter パッケージ側にしか存在しない。

### 3.7 multi-tenant

- 全テーブルで `tenant_id` は **NOT NULL**、全ての一意制約・索引の**先頭列**に置く。
- core の全 interface は第一引数に **`ctx: { tenantId, subjectId? }`** を取る。暗黙の・グローバルな
  テナント状態を runtime もモジュールスコープも持たない。
- **mnemo はテナントの台帳を持たない。** `tenantId` は呼び出し側が渡す**不透明な文字列**であり、
  認証・ユーザー管理は mnemo の仕事ではない。
- Postgres の RLS は**追加防御**として adapter 側のオプションに位置づける。一次的な分離保証は
  「ctx を引き回すこと」と「索引の先頭列が tenant_id であること」に置く。RLS を一次防御にすると、
  RLS を設定していない Store 実装（将来別 DB で書かれた adapter）で保証がまるごと消えるため。
- `packages/testkit` の store 適合テストは**必ず2テナント分のデータを入れて**走らせることを契約にする
  （詳細は §5 の各 interface の契約欄、および testkit 自体の記述に譲る）。

### 3.8 provider 境界と Structured Output

`core` は OpenAI SDK・Anthropic SDK のどちらの型も import しない。境界はこうなる。

```ts
// packages/core — provider 非依存
interface StructuredRequest<T> {
  prompt: PromptSpec;
  schema: ZodType<T>;      // core は zod でスキーマを記述するだけ
}

interface LLMProvider {
  complete(req: PromptSpec): Promise<LLMResponse>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<T>;
}
```

`packages/openai` と `packages/anthropic` はそれぞれ `LLMProvider` を実装し、内部で zod スキーマを
各社の Structured Output 形式（OpenAI の `response_format: json_schema` 相当、Anthropic の強制
tool use 相当）へ**翻訳**する。この翻訳は provider package の内側で完結し、core にも呼び出し側にも
ベンダー固有の型は漏れない。

Structured Output は次の4箇所で強く使う方針とする:

| 用途 | 何を構造化するか |
|---|---|
| 抽出（observe の sync/deferred 経路） | Observation → Memory 候補 + digest |
| 要旨生成 | Memory → digest（NOT NULL。§4 の非対称理由） |
| 統合（consolidate） | 複数 Memory → 1 Memory + `provenance.sources` |
| 矛盾判定 | 新規 Memory と既存 Memory の関係 → `active` / `superseded` / `contested` |

矛盾判定と抽出の結果は `provenance.kind = 'inferred'` として記録され、`basis`（根拠となった
memoryIds/observationIds）を伴う。**根拠を欠いた推論をそのまま提示しない**——原則の姿2の適用
（詳細は [docs/memory-model.md](./memory-model.md)）。

---

## 4. package 構成

オーナー案の表をベースに、以下の構成を採る。

```
packages/
  core        — 純粋。zod 以外の実行時依存を持たない。interface / runtime / 純関数の戦略
  testkit     — adapter が満たすべき適合テスト一式（conformance suite）
  postgres    — MemoryStore + VectorStore + RelationStore + EventStore を1接続で実装
  bullmq      — Scheduler 実装
  openai      — EmbeddingProvider + LLMProvider
  anthropic   — LLMProvider のみ
  server      — HTTP（Phase 4）
  sdk         — client（Phase 4）
```

### オーナー案から変えた3点

**`testkit` を追加した。**
「差し替え可能」という主張は、適合テストが無ければ願望に留まる。core が定義するのは型だけでなく
**振る舞いの契約**（冪等性・テナント分離・順序）であり、それを実行可能な形で持たなければ 2つ目の
adapter が書かれた瞬間に、型は同じでも振る舞いが違う実装が紛れ込む。Phase 1 の成果物に含める。

**`redis` を `bullmq` に改名した。**
依存の中心は Redis というミドルウェアではなく、Scheduler の実装である BullMQ というライブラリの方。
Redis を単体で使う用途（キャッシュ等）は Phase 3 まで発生しない。パッケージ名を実際に依存している
役割に合わせた。

**`anthropic` に `EmbeddingProvider` を置かない。**
これはオーナーの package 表への**事実訂正**である。Anthropic は埋め込み API を提供していない
（公式には外部の埋め込みモデルの利用を案内している）。`packages/anthropic` は `LLMProvider` のみを
実装する。埋め込みが要る構成では `openai` か将来追加される別 provider が必要になる。

### 依存方向

```
                       core（zod のみ）
        ┌────────┬────────┬────────┬────────┬────────┐
        ▼        ▼        ▼        ▼        ▼        ▼
    postgres   bullmq   openai  anthropic  server    sdk
        ▲        ▲        ▲        ▲
        └────────┴────────┴────────┘
              testkit（devDependency として利用）
```

**core は誰にも依存されるが、誰にも依存しない。** 逆方向の依存（core が postgres や openai を
import する）は無い。`testkit` は core の interface 型を使ってテストケースを書き、各 adapter
パッケージ（postgres / bullmq / openai / anthropic）は devDependency として `testkit` を引き、
自分の実装が適合テストを通ることを CI で確認する。`server` と `sdk` は Phase 4。`server` は
core を組み立てる合成ルート（どの adapter を使うかは server の起動設定側の責務であり、core は
関知しない）。

---

## 5. 主要 interface

各 interface は「型シグネチャ」と「契約（振る舞いの約束）」の両方で構成される。**型だけでなく
振る舞いが契約である**——例えば `MemoryStore.create` が同じ入力に対して本当に冪等かどうかは
型シグネチャからは分からない。この振る舞いの契約は `packages/testkit` の適合テストで実行可能な
形で検査される。adapter は型を満たすだけでなく、testkit のスイートを通ることで初めて「準拠」と
みなす。

共通の `Ctx`:

```ts
interface Ctx {
  tenantId: string;
  subjectId?: string;
}
```

すべての interface のメソッドは第一引数に `ctx: Ctx` を取る（§3.7）。

### 5.1 MemoryStore — Phase 1

```ts
interface MemoryStore {
  createObservation(ctx: Ctx, input: NewObservation): Promise<Observation>;
  createMemory(ctx: Ctx, input: NewMemory): Promise<Memory>;
  get(ctx: Ctx, id: MemoryId): Promise<Memory | null>;
  updateStatus(
    ctx: Ctx,
    id: MemoryId,
    status: MemoryStatus,
    opts?: { supersededById?: MemoryId }
  ): Promise<Memory>;
  reinforce(ctx: Ctx, id: MemoryId, at: Date): Promise<Memory>;
  countByGroup(ctx: Ctx, scope: RecallScope): Promise<GroupCount[]>;
}

type MemoryStatus = 'active' | 'superseded' | 'contested' | 'archived' | 'forgotten';
```

契約:
- `createMemory` は `(tenant_id, source_observation_id, extractor_version, content_hash)` の
  一意制約により冪等（§3.5）。
- `reinforce` は挿入が実際に起きたときだけ `last_reinforced_at` / `strength` を更新し、
  `decay_floor_at` を再計算する（§3.5・[docs/memory-model.md](./memory-model.md)）。
- `status = 'contested'` の Memory を単独で返す呼び出し側（recall の内部実装）は、対向する
  Memory を**スコアに関係なく必ず一緒に**取得できなければならない（mandatory companion
  retrieval）。これは原則の姿1（争われている主張を、争われていない顔で出さない）の直接の実装であり、
  MemoryStore の契約としてここに明記する。詳細な判定条件は [docs/memory-model.md](./memory-model.md)。
- `countByGroup` の返り値は近似を許すが、`countKind: 'exact' | 'lower_bound' | 'unknown'` を
  必ず伴う（[docs/recall.md](./recall.md) の目次帯）。
- テナント分離: すべてのメソッドは `ctx.tenantId` に一致しない行を返してはならない。
  `testkit` は2テナントを同時に投入し、クロステナントの取得が0件になることを検査する。

### 5.2 VectorStore — Phase 1

```ts
interface VectorStore {
  upsert(ctx: Ctx, space: EmbeddingSpaceId, memoryId: MemoryId, vector: number[]): Promise<void>;
  search(
    ctx: Ctx,
    space: EmbeddingSpaceId,
    query: number[],
    opts: { limit: number; filter: VectorFilter }
  ): Promise<VectorHit[]>;
  delete(ctx: Ctx, space: EmbeddingSpaceId, memoryId: MemoryId): Promise<void>;
}

interface EmbeddingSpaceId {
  model: string;
  dimensions: number;
}
```

契約:
- **`MemoryStore` が真実の源(source of truth)であり、`VectorStore` は再構築可能な派生索引である。**
  これは非対称な契約であり、VectorStore を失っても MemoryStore から再 embed して復旧できるが、
  逆はできない。理由の詳細は [docs/decisions/](./decisions/) の ADR に譲るが、契約としての
  非対称性自体はここに書く: adapter は VectorStore の内容だけを唯一の正とする実装をしてはならない。
- `search` の `filter` は索引で表現できる形（等値・単調な範囲比較）に限る。`ORDER BY` を距離式に
  しない、という規約は adapter 実装の責務であり、`testkit` は `EXPLAIN` で索引が使われることを
  検査する（[docs/decisions/](./decisions/) の Drizzle/pgvector ADR）。
- 埋め込みが未完了の Memory は `Memory.embeddingStatus: 'pending' | 'ready' | 'failed' | 'skipped'`
  を持つ。recall はこれを「候補にすら上がらなかった件数」として `omitted.kind = 'not_indexed'`
  で報告する——**索引の遅れを黙って無かったことにしない**。原則の姿3そのものの適用である
  （[docs/recall.md](./recall.md)）。
- **core は埋め込みの次元を知らない。** `EmbeddingSpaceId` は「(モデル, 次元)」の組を単位にし、
  空間ごとにテーブル（`memory_embeddings_<space>`）を分ける設計を前提とする
  （[docs/decisions/](./decisions/)、pgvector の可変次元列は索引が張れないため）。

### 5.3 RelationStore — Phase 2（`status`/`superseded_by_id` 列のみ Phase 1）

```ts
interface RelationStore {
  link(ctx: Ctx, kind: RelationKind, fromId: MemoryId, toId: MemoryId): Promise<void>;
  unlink(ctx: Ctx, kind: RelationKind, fromId: MemoryId, toId: MemoryId): Promise<void>;
  listRelated(ctx: Ctx, memoryId: MemoryId, kind?: RelationKind): Promise<Relation[]>;
}

type RelationKind = 'contradicts' | 'supports' | 'derived_from';
```

契約:
- 関係グラフの汎用化（`RelationStore` そのもの）は Phase 2 に置く。ただし `contested` 判定に
  必須な `superseded_by_id` 列と `status` 列は Phase 1 のスキーマに前倒しで入れる（後付けの
  マイグレーションにしない、[docs/roadmap.md](./roadmap.md)）。
- `link('contradicts', ...)` は対称関係として扱う（`listRelated` はどちら向きの `fromId`/`toId`
  で張られていても双方から引ける）。

### 5.4 LLMProvider — Phase 1

```ts
interface LLMProvider {
  complete(ctx: Ctx, req: PromptSpec): Promise<LLMResponse>;
  completeStructured<T>(ctx: Ctx, req: StructuredRequest<T>): Promise<T>;
}
```

契約:
- `completeStructured` はベンダー固有の Structured Output 機構へ翻訳する義務を negate できない
  （§3.8）。core・呼び出し側に OpenAI/Anthropic SDK の型を漏らしてはならない。
- タイムアウト・レート制限・失敗時は例外を投げる。呼び出し側（runtime）がリトライ方針を持つ。
  `LLMProvider` 自体はリトライを内蔵しない（責務の混在を避ける）。

### 5.5 EmbeddingProvider — Phase 1

```ts
interface EmbeddingProvider {
  readonly space: EmbeddingSpaceId;
  embed(ctx: Ctx, texts: string[]): Promise<number[][]>;
}
```

契約:
- 1つの `EmbeddingProvider` インスタンスは1つの `EmbeddingSpaceId` に固定される。次元をモデルに
  応じて動的に変える実装は許容しない（`VectorStore` 側がテーブルを空間ごとに分ける前提と対応する）。
- `packages/anthropic` はこの interface を実装しない（§4）。

### 5.6 Scheduler — interface は Phase 1（既定 `InlineScheduler`）、BullMQ 実装は後続フェーズ

```ts
interface Scheduler {
  enqueue(ctx: Ctx, job: OutboxJob): Promise<void>;
}
```

契約:
- `enqueue` はジョブの重複投入に対して冪等でなくてよい（重複排除は消費側/extractor の
  `(observationId, extractorVersion)` 冪等制約が担う。§3.5）。Scheduler 自体は「運ぶ」役に
  縮小されている（§3.4 の outbox 設計のおかげで Scheduler の選択が支配的な決定にならない、
  [docs/decisions/](./decisions/) の Job Queue ADR）。
- `InlineScheduler` は `enqueue` を呼び出しコンテキストの中で同期的に実行する実装であり、
  外部プロセスを必要としない。

### 5.7 ScoringStrategy / DecayStrategy — Phase 1・純関数

```ts
type ScoringStrategy = (candidate: ScoringInput) => Score;

type DecayStrategy = {
  strengthAt(now: Date, params: DecayParams): number;
  floorAt(params: DecayParams, threshold: number): Date;
};
```

契約:
- **両方とも純関数であり、状態を保存しない。** `DecayStrategy.strengthAt` の結果はどこにも
  永続化されない。永続化されるのは書き込み時に一度だけ計算する `decay_floor_at`（単調に増加する
  時刻であり、強化イベントが起きたときだけ再計算される。§3.5・[docs/decisions/](./decisions/) の
  忘却 ADR）。
- 鮮度スコアは `occurred_at ?? recorded_at` を使い、減衰は `last_reinforced_at` を使う
  （時計を混同しない。詳細は [docs/memory-model.md](./memory-model.md) の「三つの時計」）。
- half-life は Memory 単位の列として持ち、テナント設定はその既定値としてのみ使う
  （テナント全体の half-life 変更が全件再計算を要求しないようにするため）。

### 5.8 EventStore — Phase 1（監査ログ）

```ts
interface EventStore {
  append(ctx: Ctx, event: NewMemoryEvent): Promise<MemoryEvent>;
  get(ctx: Ctx, id: EventId): Promise<MemoryEvent | null>;
  list(ctx: Ctx, filter: EventFilter): Promise<MemoryEvent[]>;
}
```

契約:
- **`update` / `delete` を意図的に持たせない。** append-only。alteroid（github.com/takecchi/alteroid）の
  `JournalStore` interface が同じ形——`append` / `list` / `get` のみで update/delete が型に存在しない
  ——を採っており、mnemo はこの担保の作り方をそのまま真似る。理由は「運用の規律」ではなく
  **「型に無ければ、実装が間違って消す経路がそもそも生えない」**という静的な担保である
  （[docs/memory-model.md](./memory-model.md) の監査ログの節）。
- 本文は記録しない。記録するのは tenant_id・memory_id・kind・at・actor・digest のスナップショット・
  直前のサイズのみ。
- `forget()` は `MemoryStore.updateStatus` と `EventStore.append` を同一トランザクションで行う。
  リポジトリ層を通らない削除経路を作らない（§3.2。「必ず残る」の強制）。
- 保持期間はテナント単位で設定可能。期限切れの削除自体も `purged` イベントとして残す（件数と
  期間のみ、対象の詳細は残さない）。alteroid の JournalStore には保持期間の概念が無く、mnemo は
  multi-tenant で量が桁違いになるためこれを追加で持つ（[docs/memory-model.md](./memory-model.md)）。

### 5.9 TokenCounter — Phase 1

```ts
interface TokenCounter {
  count(text: string): { tokens: number; counter: 'heuristic' | 'exact' };
}
```

契約:
- 既定実装は文字数ベースの推定（`counter: 'heuristic'`）。モデル固有のトークナイザに依存する
  正確な実装を差し込める。**推定値を実測値の顔で返してはならない**——`counter` フィールドは
  必須であり、これも原則（姿3寄りの適用: 精度の性質を隠さない）である。

### 5.10 Clock — Phase 1

```ts
interface Clock {
  now(): Date;
}
```

契約:
- `ScoringStrategy` / `DecayStrategy` は `now` を引数として受け取る純関数であり、`Clock` を
  直接は使わない。`Clock` は runtime が「現在時刻」を取得する唯一の場所であり、テストで固定時刻を
  注入できるようにするための境界。alteroid・オーナー案のどちらにも無いが、multi-tenant・複数
  インスタンスで動く mnemo では時刻取得を暗黙に `new Date()` へ散らさないための最小限の追加である。

### 5.11 Sensor / SpeechPolicy — Phase 3、形のみ

```ts
interface Sensor {
  // Phase 3。何を「観測すべき出来事」として検知するかの詰めはまだ無い。
}

interface SpeechPolicy {
  // Phase 3。「いつ mnemo 側から話しかけてよいか」の詰めはまだ無い。
}
```

正直に書く: この2つは Phase 1〜2 の設計検討の対象外であり、**現時点では interface の形すら
仮置きに過ぎない。**動詞5つ（observe/recall/reflect/consolidate/forget）との関係、Ctx との
関係も未検討。ここでの掲載はオーナー要求の11項目網羅のためであり、設計が済んでいることを
意味しない。

---

## 確かめていないこと（この doc に関わる範囲）

- 抽出の既定を `sync` にするか `deferred` にするか（§3.3）はオーナー判断が必要で、まだ決まっていない。
- `packages/testkit` が実際にどこまでの振る舞い（順序・並行性）を検査できるかは、testkit 自体の
  設計（Phase 1 着手時）に委ねられており、この doc の時点では契約として書けるが実装されていない。
