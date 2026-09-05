# ADR 0016: DB テストの排他は依存グラフに頼らず、門のコード自身に載せる

- **状態**: 採用 (2026-09)

- **文脈**:

  `packages/postgres` と `examples/chat` はどちらも `test:db` を持ち、
  `scripts/run-db-tests.mjs`（ADR 0015）が `DATABASE_URL` 在りのとき
  `pnpm --recursive --if-present run test:db` を一度呼ぶだけでこの2つを実行していた。
  手元でもCIでも、この2つは常に `packages/postgres` → `examples/chat` の順に
  **直列に**走っており、それが「排他になっている」という認識だった。

  マネージャーが実測したところ、**この直列は排他ではなく偶然だった。**

  - `pnpm --help recursive` の `--sort`（既定で有効。依存パッケージを先に実行する）と
    `--workspace-concurrency`（既定値 4）を確認すると、直列になっていたのは
    `examples/chat` が `@mnemora/postgres` に `workspace:*` で依存しているから
    にすぎない。依存関係の無いパッケージ同士は最大4並行まで許される。
  - 実際に、`@mnemora/postgres` に依存しない `test:db` パッケージを1つ一時的に足し、
    `pnpm --recursive --if-present run test:db` を実行すると、それは
    `packages/postgres` / `examples/chat` と**並行に**走った
    （タイムスタンプで区間の重なりを実測して確認）。
  - その一時パッケージに、`packages/postgres/src/__tests__/test-db.ts` /
    `examples/chat/src/__tests__/test-db.ts` の `resetTestDatabase()` と同じ7テーブル
    （`memories` / `observations` / `memory_events` / `recalls` / `recall_usages` /
    `outbox` / `tenant_settings`——埋め込み空間ごとのテーブルはパッケージごとに別だが、
    この7つはテナント横断・スイート横断で完全に共有される）へ200ms間隔で
    `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` を撃たせ、既存の2パッケージの
    `test:db` と並行に走らせたところ、**`packages/postgres` の `test:db` が
    10試行中10試行とも赤くなった**（外部キー違反、「作ったはずの行が無い」という
    アサーション失敗、統計情報の激変によるクエリプラン変化——壊れ方は試行のたびに
    違い、非決定的だった）。同じ手順から並行だけを取り除いた対照は5試行中5試行とも
    緑だった。この対照により、赤の原因が DB の立て方・pgvector・マイグレーション・
    テストコード自体ではなく、**並行アクセスそのもの**であることを切り分けた。

  つまり、依存関係を持たない `test:db` パッケージが3つ目として増えた瞬間、
  この壊れ方が現実になる。`resetTestDatabase()` の `tenant_id` によるテナント分離は
  クエリの `WHERE` 句にしか無く、`TRUNCATE` には一切効かない。

  副次的に、pnpm の `--bail`（既定で有効）は**最初の失敗で新しいパッケージの起動を
  止めるだけで、既に起動済みの兄弟プロセスを殺さない**ことも実測で分かった。
  上記の一時パッケージのプロセスは、`packages/postgres` の失敗でゲートが赤で終わった
  あとも生き残り、次の試行の DB に影響を与え続けた（`kill` で手動停止が必要だった）。

- **検討した選択肢**:

  1. **`pnpm --recursive --workspace-concurrency=1 --if-present run test:db` に
     フラグを足すだけ。** 排他は成立するが、
     - 排他が「pnpm のフラグの意味」に載り、この門のコード自身は何も約束していない
       ことになる（歯（後述）が測るべき対象が曖昧になる）
     - `--bail` が兄弟プロセスを殺さない、という上記の副次的な欠陥は残る
       （新しいパッケージの起動は1つずつになるが、失敗後に前のプロセスが生き残る余地は
       フラグだけでは塞がらない——1本ずつ確実に完了を待ってから次を起動する、という
       制御はやはりこの段のコードが持つ必要がある）
     - どのパッケージで落ちたかを pnpm の標準出力から人間が読み取るしかない

     採らない。理由の重みは3点目より1・2点目の方が大きい。

  2. **パッケージごとに専用データベースを用意する**（`mnemora_test_postgres` /
     `mnemora_test_chat` のように分ける）。危険の実体を最も直接に断てるが、
     CI の3ジョブ（`postgres` / `example-chat` / `root-gate-db-stage`）は
     いずれも `mnemora_ci` という同じ DB 名の**独立した** service container を
     使っており、ジョブをまたいだ競合はそもそも起きていない
     （実測して確認した。「PR #11 で専用データベースを使う形が入った」という
     見立ては誤りだった）。危険が実際に起きるのは
     **同一プロセス群が同一 DB を共有する場面**（手元の1つの DB を複数の
     `test:db` プロセスが同時に叩く場面）に限られる。専用 DB は
     マイグレーションの実行口・接続文字列の組み立て・CI のワークフロー定義など
     移行・CI 双方に広く手を入れる割に、危険の実体に対して過剰である。採らない。

  3. **`scripts/run-db-tests.mjs` 自身のコードで、1パッケージずつ直列に実行する
     （採用）。** `findDbTestPackages()` が既に持っている対象一覧を、
     `pnpm --filter <name> run test:db` で1本ずつ呼ぶループへ変える。

- **決定**:

  `scripts/run-db-tests.mjs` の実行部を、`pnpm --recursive --if-present run test:db`
  の一発呼びから、`findDbTestPackages()` の一覧を**1つずつ** `pnpm --filter <name>
  run test:db` で呼ぶループへ変える。前のパッケージの `test:db` プロセスが完全に
  終了する（`spawnSync` が返る）まで、次のパッケージは起動しない。

  一覧の順序は、対象パッケージ同士の `dependencies` / `devDependencies` を見て
  位相ソートする（依存パッケージを先に）。依存関係の無い組同士は名前順に固定するが、
  **どちらが先でも安全でなければならない**——安全でないなら、それは各パッケージの
  `test:db` 側の独立性が壊れている。

  外形（`root-gate-db-stage` が `grep` している文言・終了コードの意味）は変えない:

  | 状態 | 終了コード | 出力 |
  |---|---|---|
  | `DATABASE_URL` 未設定 | 0 | 「実行していない」と明示（変更なし） |
  | 設定済み・全パッケージの `test:db` が通った | 0 | 「✔ DB テストも実行し、通りました。」（変更なし） |
  | 設定済み・いずれかの `test:db` が落ちた | 非0 | 「✗ DB テストが落ちました（\<name\>）。」——どのパッケージかを名指しする（拡張） |

- **理由**:

  排他を pnpm のフラグではなくこの段のコード自身に持たせるのは、
  「この段が何を保証しているか」を、pnpm のバージョンやデフォルト値の変化から
  独立させるためである。`--workspace-concurrency` の既定値が変わっても
  （あるいは誰かが `.npmrc` で変えても）、この段のループはそれに左右されない。

  また、`--bail` が兄弟プロセスを殺さないという実測結果は、
  「1つずつ確実に完了を待ってから次を起動する」という制御そのものでしか
  塞げない。フラグ渡しでは、失敗後に前段のプロセスが生き残る余地を
  構造的に消せない。

- **歯（この決定を測る歯）**:

  `scripts/__tests__/run-db-tests-exclusivity.test.mjs` を新設した。
  静的な検査（コードの文字列を `grep` する類）ではなく、**振る舞い**を測る:

  一時的な擬似ワークスペース（`pnpm-workspace.yaml` + `test:db` を持つ
  パッケージ2つ）を作る。**この2つは互いに依存させない**——依存させると、
  いま外そうとした「依存グラフのたまたまの直列」を歯の中で再現するだけになり、
  この段自身が持つ排他を何も測れなくなる。各 `test:db` は開始・終了時刻を
  1つのログファイルへ書いて数百msだけ眠る、それだけの純粋関数（DB は要らない。
  `DATABASE_URL` はダミーの接続文字列で足りる——このスクリプトは
  `DATABASE_URL` の有無だけを見て `test:db` を呼ぶかどうかを決め、
  接続文字列の中身までは検査しないため）。

  既存の歯（`scripts/__tests__/run-db-tests.test.mjs`）と同じ流儀で、
  **本物の `scripts/run-db-tests.mjs` を子プロセスとして起動する**。
  ただしシンボリックリンクは使えなかった——Node は `import.meta.url` を
  実体パスへ解決するため、擬似ワークスペースの `scripts/` へシンボリックリンクを
  置いても、スクリプトは自分の居場所を本物のリポジトリだと誤認識する
  （実測して確認した）。実行の都度、本物のファイルを擬似ワークスペースへ
  **コピー**して使う。

  検査するのは「2つの区間が重ならないこと」であり、「ループを書いたかどうか」
  ではない。

  **変異試験**: 実装後、`scripts/run-db-tests.mjs` の実行部を一時的に
  `pnpm --recursive --if-present run test:db` の一発呼びへ戻し
  （排他を外す変異）、上記の歯を実行したところ、実際に赤くなった:

  ```
  AssertionError: 2つの区間が重なっている(並行に走った):
  [{"name":"pkg-a","start":1788620018805,"end":1788620019205},
   {"name":"pkg-b","start":1788620018808,"end":1788620019209}]
  : expected true to be false
  ```

  （PR 本文に、もう1種類の変異（`--workspace-concurrency Infinity` を足した
  一発呼び）でも赤くなったことを含め、詳細を貼る。）

  変異を戻すと、歯は緑に戻ることも確認した。

- **結果（この決定が招くもの）**:

  - `scripts/run-db-tests.mjs` は `pnpm` プロセスを1回ではなく対象パッケージ数だけ
    起動する（現状は2回）。実測した所要時間の差は PR 本文を参照——
    直列だった実行が直列のまま実行されるだけなので、理論上は
    ほぼ変わらないはずだが、「はず」ではなく実測の数字で確認した。
  - CI の `postgres` / `example-chat` ジョブは `test:db` を各パッケージへ
    直接呼んでおり、`run-db-tests.mjs` を経由しないため無変更。
    `root-gate-db-stage` は `run-db-tests.mjs` の出力文言を `grep` しているだけで、
    その文言は変えていないため無変更。ワークフロー定義には手を入れていない。

- **これが覆るとしたら**:

  - `test:db` を持つパッケージが増え続け、直列実行の総所要時間が長くなりすぎたとき。
    そのときは「依存関係の無い組は並行に走らせてよい」という設計へ広げる余地はあるが、
    その場合も `resetTestDatabase()` 側がテーブル単位ではなくスキーマ単位・
    トランザクション単位で隔離される変更とセットでなければ、この ADR が
    問題にした壊れ方をそのまま再導入する。
  - `packages/postgres` / `examples/chat` 以外にも DB を要求する検査の種類が増え、
    パッケージ単位の直列では足りない粒度の排他が要るようになったとき。

- **確かめていないこと**:

  - **`runMigrations()`（`packages/postgres/src/migrate.ts`）に advisory lock が無く、
    まっさらな DB に2プロセスが同時に初回マイグレーションを走らせると理論上失敗する**
    （`CREATE TABLE observations` に `IF NOT EXISTS` が無いため）。この ADR の排他は
    `scripts/run-db-tests.mjs` を経由した場合にのみ効くため、この段を通す限りは
    2つの `test:db` プロセスが同時に `runMigrations()` の初回実行へ突入することは
    構造的に無くなるが、**まっさらな DB に対して2プロセスを実際に同時起動して
    このエラーを発生させたことは無い**。段階1では実測していない。
  - **門を通さず `pnpm -r run test:db` や `pnpm --parallel run test:db` を
    直接叩く経路には、この排他は一切効かない。** `scripts/run-db-tests.mjs` は
    ルートの `test` 門からしか呼ばれないため、これらを手元で直接叩けば
    この ADR が塞いだはずの壊れ方がそのまま再現する。これは意図した範囲の限界であり
    （このスクリプトの外側の呼び出し経路まで塞ぐのは過剰）、
    塞いでいないことを明示しておく。
  - **`examples/chat` 側が実際に壊れるところは観測していない。** 段階1の10試行は
    いずれも pnpm の `--bail`（既定で有効）により `packages/postgres` の失敗で
    早期終了し、`examples/chat` の `test:db` が起動される前にゲートが終わっていた。
    `examples/chat/src/__tests__/test-db.ts` の `resetTestDatabase()` は
    `packages/postgres` 側と全く同じ実装（同じ7つの共有テーブルへの
    `TRUNCATE ... RESTART IDENTITY CASCADE`）であり、コード上は同一の脆弱性を
    持つと判断できるが、**実際に赤くなるところを見てはいない。**
