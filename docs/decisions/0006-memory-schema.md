# ADR 0006: Memory schema の設計判断

- **状態**: 採用 (2026-09)

- **文脈**:
  Memory は mnemo の中心的なデータであり、矛盾の扱い・provenance・時刻・監査・冪等という複数の
  要求が1つのスキーマに集約される。**この ADR はスキーマの DDL 自体を扱わない**（DDL は
  `docs/memory-model.md` を参照）。ここに書くのは **なぜその形にしたか** という判断の記録である。

- **検討した選択肢**:
  - **単一の JSON カラムに全部入れる**（status・provenance・時刻等をスキーマレスな JSON にまとめる）:
    柔軟性は高いが、フィルタ（`status = 'active'`）や索引（`superseded_by_id` を辿る）を
    SQL レベルで表現できなくなる。recall の二段検索（`0004-decay-at-query-time.md`）は索引が効く
    フィルタを要求するため、JSON への格納はこの要求と正面から衝突する。却下。
  - **Memory を Markdown 文書単位にする**（alteroid 方式）: alteroid (github.com/takecchi/alteroid) は
    記憶を Markdown ファイル + frontmatter として持ち、人間が直接編集できる。**mnemo ではこの方式を
    採らない。**理由は下記「決定」参照（alteroid の現物調査は
    [docs/alteroid-findings.md](../alteroid-findings.md) の主張Aを参照）。
  - **列で持つべき情報を絞り、大半を関連テーブル（イベント、関係）に逃がす**: 採用（下記の設計方針）。

- **決定と理由（個々の設計判断）**:

  **`status` を列で持ち、既定の recall は `superseded` を返さない。**
  順位付け（スコアを下げて後方に置く）ではなく、フィルタ（そもそも候補に含めない）で解く。
  理由: 順位付けは負荷や候補数が増えると容易に崩れる（下位に沈んだはずの記憶が予算の都合で
  再び上位に出てくる、といった事故が起きうる）が、`WHERE status = 'active'` によるフィルタは
  索引が効く限り崩れない。

  **`superseded_by_id` を列で持つ。**
  グラフ探索（関係テーブルを辿る）ではなく、索引で直接引けるようにするため。関係グラフ本体
  （`RelationStore`、`contradicts` / `supports` / `derived_from` の汎用化）は Phase 2 だが、
  **`status` と `superseded_by_id` の列は Phase 1 のスキーマに入れる。**理由は「矛盾の扱い」が
  Phase 1 の recall に必須な機能であり、後付けのマイグレーションで列を足すコストより、最初から
  持たせるコストの方が低いため。

  **三つの時計（`occurred_at` / `recorded_at` / `last_reinforced_at`）を分ける。**
  `occurred_at` はその出来事・事実がいつのものか（不明なら NULL 可）、`recorded_at` は mnemo が
  いつ知ったか（NOT NULL）、`last_reinforced_at` は最後に実際に使われたのはいつか、を表す。
  混ぜて1つの「時刻」にすると後から分離できない。**鮮度スコアは `occurred_at ?? recorded_at` を
  使い、減衰は `last_reinforced_at` を使う。**この2つは別の目的の時刻であり、同じ列を使い回すと
  「昔起きたが最近よく使う記憶」と「最近起きたが一度も使われていない記憶」を区別できなくなる。

  **`provenance_kind` を列に出す。**
  フィルタと索引のために `provenance_kind`（`stated | inferred | consolidated | reflected | imported`）
  を列にし、詳細（`basis` や `sources` 等）は別列の JSON に持つ。**この列そのものが、
  「AI の推論とユーザーが言った事実を区別する」という原則の実装である。**別フラグを追加で持つのではなく、
  `provenance.kind` という判別可能ユニオンのタグそのものがこの区別を担う。

  **`digest` を NOT NULL にする。**
  alteroid では要旨（`description`）は書き手が frontmatter に手書きするものであり、書かれていない
  場合は固定文言「（要旨なし）」が使われる（先頭 N 文字への機械的フォールバックすら無い）。
  **mnemo は digest を抽出時に LLM で生成し、NOT NULL とする。**これは alteroid と意図的に異なる
  設計判断である。理由: mnemo は人手による編集を前提にしないパイプライン（`observe → extract`）で
  Memory を作るため、「書き手が要旨を書き忘れる」という状況自体が起こらない設計にする方が、
  目次帯（`docs/decisions/0008-absence-taxonomy.md` および `docs/recall.md`）の被覆不変条件を
  常に成立させやすい（詳細は [docs/alteroid-findings.md](../alteroid-findings.md) 主張A参照）。

  **冪等のための一意制約を持つ。**
  `externalId`（テナント内一意、Observation の再送検知）、
  `(observationId, extractorVersion)`（抽出の冪等性。実際には
  `(tenant_id, source_observation_id, extractor_version, content_hash)` に一意制約を張る）、
  `(recall_id, memory_id)`（使用報告の冪等性、主キー）。**カウンタを直接インクリメントする実装を
  設計原則として禁止する。**値を+1するのではなく、一意制約を持つ行の挿入が実際に起きたかどうかで
  数える。再送・二重配信を前提にした at-least-once の設計であり、行の存在がそのまま「起きたかどうか」
  の記録になる。

- **却下した案（再掲・理由の要約）**:
  - 単一 JSON カラム: フィルタ・索引の要求と衝突するため却下。
  - Markdown 文書単位（alteroid 方式）: mnemo は人手編集を前提にせず、抽出パイプラインで機械的に
    Memory を作る。また Markdown 文書単位は粒度が粗く、強化・忘却を Memory 単位（個々の事実・主張の
    単位）で効かせたい mnemo の要求と合わない。1つの Markdown 文書に複数の主張が混在すると、
    その一部だけを `superseded` にする、その一部だけを強化する、といった操作ができなくなる。

- **結果（この決定が招くもの）**:
  良い面: フィルタ・索引・冪等性のすべてが SQL レベルで直接表現できる。矛盾の扱い・provenance の
  区別・監査という Phase 1 の要求機能が、後付けマイグレーションなしにスキーマへ収まっている。

  引き受ける負債: 列数が増え、スキーマの見通しが単一 JSON カラム方式より悪くなる。Phase 1 の
  時点で「使わない Phase 2 機能のための列」（`superseded_by_id` 等）を先に持つため、実装が
  追いつくまでの間、部分的に空の列が存在する。

- **これが覆るとしたら**:
  - Memory の粒度を意図的に粗くしたい利用ケース（人手で管理する少数の長文記憶が中心の用途）が
    主要なユースケースとして浮上したら、Markdown 文書単位に近い形の代替スキーマを別 adapter として
    検討する余地はある。ただしそれは mnemo の core スキーマの変更ではなく、別の抽象レベルでの対応になる。

- **確かめていないこと**:
  - digest 生成の LLM コスト・品質が、抽出パイプライン全体のボトルネックになるかどうかは、
    Phase 1 の実装・実測を経ないと分からない。
