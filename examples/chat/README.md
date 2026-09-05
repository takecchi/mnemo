# examples/chat

roadmap.md 段階7「サンプル」。**このサンプルの主目的は「動くデモ」ではなく、
[docs/north-star.md](../../docs/north-star.md) の物差し——

> 使う側が、会話ログを全部プロンプトへ積むのをやめられたか。

——を実際に測ることである。** 機能が動くこと自体は物差しに対して何も言えない
（同 doc「記憶の件数でも、機能の数でも、recall の平均スコアでもない」）。

同じ会話に対して2つの経路を並べて走らせ、実際にプロンプトへ積む量を実測して比較する。

- **経路A（naive）**: 会話ログを全部プロンプトへ積む（mnemo を使わない、今の普通のやり方）。
- **経路B（mnemo）**: `observe()` で会話を取り込み、`recall()` が返した `memories`（の
  digest）と `index` だけを積む。`budget` を渡すと実際に切り詰められる。

---

## 動かし方

前提: Node 22 / pnpm（corepack）。ローカルに Postgres + pgvector が必要
（[AGENTS.md](../../AGENTS.md) 参照、または CI の `example-chat` ジョブと同じ
`pgvector/pgvector:pg17` イメージ）。

```bash
# リポジトリルートで
pnpm install
pnpm run build   # @mnemo/core 等の workspace パッケージを dist へビルドする
                 # （tsx で直接実行する examples/chat の CLI は dist を node_modules 経由で
                 #   解決するため、ビルドが要る。vitest はテスト時だけ src を直接見るため
                 #   ビルド無しでも動く——後述「テスト」参照）

export DATABASE_URL="postgresql://user@host/dbname?host=/path/to/sockdir&port=5544"
pnpm --filter @mnemo/postgres run migrate

# observe → recall の往復、omitted/usage/budget を実演する
pnpm --filter @mnemo/example-chat run chat

# 会話の長さを変えて、経路A/経路Bの量を実測する（このサンプルの主目的）
pnpm --filter @mnemo/example-chat run compare
```

`OPENAI_API_KEY` を環境に設定すると本物の OpenAI（LLM 抽出・Embedding）で動く。
設定しなければ `@mnemo/testkit` の決定的な擬似 provider で動く——**どちらで動いているかは
起動直後に必ず画面へ出す**（黙って擬似物にフォールバックしない）。

### テスト

```bash
export DATABASE_URL=...
pnpm --filter @mnemo/example-chat run test:db
```

本物の Postgres に接続する（擬似物では代替しない）。`observe → recall` の往復・
`budget` による切り詰め・`runComparison` の量の計測をすべて実DBに対して検査する。
ビルド不要（`vitest.config.mts` が `@mnemo/*` を各パッケージの `src` へ直接エイリアスする）。

---

## `chat`: observe/recall の往復・omitted・usage・budget

固定の合成会話（後述）を `observe()` で取り込み、終盤の質問を `recall()` する。
`recall()` の返り値のうち roadmap.md 段階7の完了条件そのものである `omitted` と
`usage` を画面に出し、さらに小さな `budget`（`maxMemoryChars`）を渡した場合に実際に候補が
落ちること（`omitted` に `budget_dropped` が現れ、`memories` の件数が減ること）を示す。

---

## `compare`: 量の比較（このサンプルの主目的）

会話の長さ（filler の往復数）を `[0, 1, 2, 3, 4, 5, 10, 20, 40, 80, 160, 320, 642(turns)]`
と変化させ、各長さについて独立のテナントで:

- **経路A**: 全ターンを `role: text` 形式で連結した文字列の長さ（`chars`）と、
  `heuristicTokenCounter`（core の既定の文字数ベース推定）によるトークン数。
- **経路B**: 同じ会話を `observe()` で取り込み、終盤の質問を `recall()`（**budget 無し**）
  した際の `usage.chars` / `usage.estimatedTokens`——`recall()` 自身が計測した値を
  そのまま使う（自前で数え直さない）。

を測る。**budget は渡さない**——docs/roadmap.md §4「計測と抑止を混同しない」の通り、
ここで見せたいのは「切り詰めずに、そのままだと何文字になるか」であり、強制ではなく
計測の比較だからである（budget が実際に切り詰めることは `chat` サブコマンドの方で見せる）。

### 実測結果（2026-09-05、`@mnemo/testkit` の決定的な擬似 provider・`pgvector/pgvector:pg17` 相当のローカル環境）

`pnpm --filter @mnemo/example-chat run compare` の実際の出力（再現可能。同じ環境・
同じ会話生成関数であれば同じ数字になる——`buildConversation()` は乱数を使わない）。

| 会話ターン数 | naive chars | naive tokens(概算) | mnemo chars | mnemo tokens(概算) | mnemo/naive (chars) |
|---|---|---|---|---|---|
| 2 | 49 | 13 | 131 | 33 | **267.3%** |
| 4 | 97 | 25 | 142 | 36 | **146.4%** |
| 6 | 150 | 38 | 161 | 41 | **107.3%** |
| 8 | 197 | 50 | 178 | 46 | 90.4% |
| 10 | 243 | 61 | 193 | 50 | 79.4% |
| 12 | 294 | 74 | 211 | 54 | 71.8% |
| 22 | 552 | 138 | 288 | 75 | 52.2% |
| 42 | 1048 | 262 | 292 | 76 | 27.9% |
| 82 | 2064 | 516 | 310 | 80 | 15.0% |
| 162 | 4083 | 1021 | 303 | 78 | 7.4% |
| 322 | 8134 | 2034 | 305 | 79 | 3.7% |
| 642 | 16223 | 4056 | 305 | 79 | 1.9% |

### 正直に読むべきこと

**⚠ 会話が短いうちは経路Bのほうが多い。** `2`〜`6` ターンでは mnemo のほうが naive より
**大きい**（最大 +167%）。理由は2つ:

1. `recall()` は index band（目次帯・第3階の群カウント）の JSON を必ず含む固定費を持つ。
   会話が短いとこの固定費が相対的に大きく見える。
2. `observe()` → 抽出 → 埋め込み → `recall()` という往復自体にも、返す memory 1件あたり
   digest という形の一定のオーバーヘッドがある。

**この実測では、`8` ターン（filler 往復3組＋事実表明1組）から経路Bが下回り始める。**
それ以降は単調に差が開く——naive は会話が伸びる限り線形に増え続けるのに対し、mnemo は
既定の `recall()` の `limit`（10件）と index band の固定費でほぼ頭打ちになる
（`162`→`642` ターンで naive は 4倍になるが mnemo はほぼ変わらない）。

**この閾値（8ターン）は、この会話生成関数・この既定パラメータ（`limit=10` 等）・
この擬似 provider に固有の数字であり、一般的な閾値として主張しない。** 会話の内容
（filler の長さ・事実の長さ）や `recall()` のオプションを変えれば動く。


### ⭐ 削減率だけでは意味を持たない——答えが残っているか

**何も返さなければ削減率は 0% になる。** 削減が意味を持つのは、**呼び出し側が探している
答えが、削られた後にも残っている**場合だけである。物差し（「会話ログを全部プロンプトへ
積むのをやめられたか」）は、積むのをやめても答えが得られることを含意している。

そこで、冒頭で一度だけ表明した事実（`FACT_STATEMENT` = 「私の好きな色は青です。……」）が、
絞り込みの後にも `recall()` の返り値に残っているかを、全ての会話長で確認した。

| 会話ターン数 | スコープ内の Memory | 返った件数 | 冒頭の事実が残っているか |
|---|---|---|---|
| 2 | 1 | 1 | ✅ |
| 8 | 4 | 4 | ✅ |
| 32 | 16 | 10 | ✅ |
| 82 | 41 | 10 | ✅ |
| 162 | 81 | 10 | ✅ |
| 322 | 161 | 10 | ✅ |
| 642 | 321 | 10 | ✅ |

**642ターン（321件のうち10件だけを返す＝ naive の 1.9%）まで削っても、冒頭の事実は落ちなかった。**
これが「1.9%」という数字に意味を与えている唯一の根拠である。

この検査は `src/__tests__/mnemo-path.postgres.test.ts` に歯として入れてある（162ターン）。
歯には「実際に大幅な絞り込みが起きていること」の前提検査も含めてある——
絞り込みが起きていなければ「残った」ことに意味が無く、`limit` が緩んだ瞬間に
この歯は無意味な緑になるため。

**⚠ この表が主張しないこと**: 擬似 embedding は意味的な類似度を持たないので、これは
「意味的に関連する記憶が正しく上位に来る」ことの証明では**ない**。主張しているのは、
**この決定的なシナリオにおいて、量を1桁以上削っても目的の記憶が落ちなかった**という
事実だけである。実 API キーでの検証は行っていない（下記「この実測の限界」）。

### この実測の限界

- **擬似 embedding は意味的な類似度を表現しない。** `DeterministicEmbeddingProvider`
  は文字コードの合計から機械的にベクトルを作るだけで、実際に「関連する記憶が正しく
  上位に来ているか」はこの実測では検証していない（`packages/testkit` 自身のコメントに
  明記されている限界であり、隠していない）。**主に測っているのは「recall がどれだけの量を
  返すか」である。**「正しいものを返すか」については、上記の通り
  **この決定的なシナリオで目的の記憶が落ちないこと**までは確認したが、
  **一般に意味的な関連度で正しく順位付けできるかは確認していない。**この2つを混同しないこと。
  後者を測るには
  `OPENAI_API_KEY` を使った実行が必要だが、このリポジトリの CI・この実測環境には
  実 API キーが無いため、**確認していない。**
- **naive path はシステムプロンプト・ツール定義を含まない生の transcript だけを測る。**
  実際のアプリケーションはこれらが上乗せされる分、絶対値としての削減幅はさらに
  大きくなりうる（逆に mnemo 側の固定費の比率は相対的に小さくなる）。
- **`budget` は `memories` tier（digest の合計文字数）だけを切り詰め、`index` tier
  （目次帯の JSON）は切り詰めない。** これは意図した設計である——目次帯の唯一の存在理由は
  「recall が0件でも、何が在るかは言える」ことであり
  （[ADR 0008](../../docs/decisions/0008-absence-taxonomy.md)）、
  **呼び出し側が渡した数字ひとつでその保証が消えてはならない。**
  したがって `budget.maxMemoryChars` より目次帯のほうが大きい場合、
  `usage.chars`（全量）は予算を上回る。これは隠さずそのまま出す。
  ただし `usage.share` は「**予算の対象が予算のどれだけを使ったか**」なので 1 を超えない。
  目次帯の実費は `usage.indexChars` として別に返るため、
  呼び出し側は `chars` と `indexChars` を見れば「なぜ全量が予算を上回ったか」が分かる。

  **この節は当初、`share` が 248.3% になることを「仕様どおりの挙動」として記録していた。
  それは誤りだった**——割合として成立しない数を割合の顔で返していた。
  予算の項目名（`maxChars` → `maxMemoryChars`）と `share` の定義を直してある
  （[docs/recall.md §6](../../docs/recall.md) の2つの訂正節を参照）。
  「セッション全体でどれだけ削れたか」ではない（[docs/recall.md §6](../../docs/recall.md)
  「セッション基準値を持たない」を参照。mnemo はセッションという概念を持たない）。
- この比較は**会話1本・固定のシナリオ**に基づく。実際の効果は会話の性質
  （どれだけ「思い出す価値のある事実」対「filler」の比率があるか）に強く依存する。

---

## この会話生成（`src/scenario.ts`）について

`buildConversation(fillerPairs)` は乱数を使わない決定的な関数——同じ `fillerPairs` を
渡せば誰が実行しても同じ会話・同じ文字数になる（測定の再現性のため）。冒頭に1件だけ
「後から参照される事実」（好きな色・誕生日）を置き、その後に filler な世間話の往復を
`fillerPairs` 組並べ、最後に冒頭の事実を尋ねる質問を置く。

**決めたこと**: `observe()` するのは user の発話だけで、assistant の応答は取り込まない
（`ingestConversation` 参照）。実際のアプリケーションが「ユーザーが言った事実だけを
覚えさせ、assistant 側の文面は都度生成する」という使い方をする、という想定に基づく
裁量である。naive path（経路A）は逆に両方の発話を含む全 transcript を積む——
これは「今の普通のやり方」（会話ログを全部渡す）を模すためであり、両者に同じ会話を
与えつつ、経路ごとに扱いが違うのは意図的である。

---

## 設計上の決めたこと（本 PR の裁量）

- **`ingestConversation`（取り込み）と `queryRecall`（想起）を分離した。** 当初
  `runMnemoPath` に両方を混ぜていたところ、`budget` 有り/無しで2回 recall を試すために
  同じ会話をもう一度 `observe()` してしまい、Memory が重複するバグを自分で踏んだ
  （`externalId` を設定していなかったため）。修正として `externalId: turn-${index}` を
  付けて冪等にした上で、取り込みと想起を別関数に分けた。**この経緯は
  `src/mnemo-path.ts` のコメントに残してある。**
- 会話の長さを変えて測る際（`runComparison`）、**長さごとに別のテナントを使う。**
  同じテナントに会話を積み増すと、後の計測が前の会話の記憶を引きずり、
  「その長さの会話単体で何文字になるか」を独立に測れなくなるため
  （`src/compare.ts` 参照。この分離が効いていることは
  `src/__tests__/compare.postgres.test.ts` の「長い会話を先に測ってから短い会話を測る」
  テストで検査している——短い方を先に測る順序ではこの種のバグを検出できないことに、
  実際にテストを書く過程で気づいた）。

---

## 本 PR で見つけて直した既存の不具合

`@mnemo/core` の `package.json` に `"type": "module"` が無く、`dist/` が
CommonJS として出力されていた（他の3パッケージ——`@mnemo/openai`・`@mnemo/postgres`・
`@mnemo/testkit`——はいずれも `"type": "module"` を持ち ESM を出力する）。

このサンプルアプリが `tsx` で `dist` を実際に実行する初めての利用者になったところ、
`import { heuristicTokenCounter } from "@mnemo/core"` が
`SyntaxError: does not provide an export named 'heuristicTokenCounter'` で落ちた
（プレーンな `node` 経由の ESM import では問題が顕在化せず、`tsx` のローダー経由でのみ
再現した——CJS→ESM 相互運用の名前付き export 検出が、ローダーの実装によって挙動が
変わるため）。これまでの `packages/*` のテストはすべて `vitest.config.mts` が
`@mnemo/core` を `src` へ直接エイリアスしており、`dist` を経由する経路が
一度も検査されていなかった。`packages/core/package.json` に `"type": "module"` を
追加し、`dist/index.js` が名前付き `export` 文を持つ本物の ESM になることを確認して
修正した。**新しい ADR は起こしていない**——既存のどの ADR の決定も覆していない、
実装側の設定漏れの修正であるため。
