# ADR 0010: 減衰の式とパラメータを固定する

- **状態**: 採用 (2026-09)

- **文脈**:
  [ADR 0004](./0004-decay-at-query-time.md) は「減衰した値を保存せず、閾値を割る時刻
  （`decay_floor_at`）を保存する」という構造を決めた。しかし、その式そのもの——
  `strengthAt` がどう `strength` と経過時間から現在の強度を導くか、`floorAt` が
  どの閾値を使うか——はまだ決めていなかった。`packages/core` の `defaultDecayStrategy`
  を実装するには、この式を具体的な数値・分岐まで固定する必要がある。

- **決定**:
  `defaultDecayStrategy` を次のとおり固定する。

  ```
  strengthAt(now, { lastReinforcedAt ?? recordedAt, strength, halfLifeHours })
    = strength * 0.5 ** (elapsedHours / halfLifeHours)

  elapsedHours = (now - (lastReinforcedAt ?? recordedAt)) / 1時間
  ```

  `floorAt(params, threshold = 0.05)` は次のとおり:

  - `strength > threshold` の場合: `base + halfLifeHours * log2(strength / threshold)` 時間後。
    （`base = lastReinforcedAt ?? recordedAt`。導出: `strengthAt` が `threshold` に等しくなる
    時刻を `elapsedHours` について解くと `elapsedHours = halfLifeHours * log2(strength / threshold)`
    になる。）
  - `strength <= threshold` の場合（既に閾値以下）: `base` をそのまま返す。この Memory は
    作成時点・強化時点で既に閾値を割っているため、`decay_floor_at` は過去の時刻になる
    （忘却対象として扱われることをそのまま表す。異常値ではない）。

  閾値の既定は **0.05** とし、`packages/core` が `DEFAULT_DECAY_THRESHOLD` として export する。
  `floorAt` の `threshold` 引数は省略可能にし、省略時にこの既定値を使う。

- **検討した選択肢**:
  - **線形減衰**（`strength - k * elapsedHours`）: 実装は単純だが、half-life という語彙
    （`half_life_hours` 列名、ADR 0004・0006 の記述）と噛み合わない。half-life は指数減衰の
    語彙であり、線形減衰を採ると列名と式の意味が食い違う。却下。
  - **`threshold` を固定値にせず必須引数のままにする**（省略不可）: 型としては最も単純だが、
    D11（オーナー決定）が「閾値の既定は0.05」と明示しており、呼び出し側に毎回同じ定数を
    渡させるのは冗長。省略可能にして既定値を `core` 側に持たせる方が「妥当なデフォルトを
    技術側で決め切れる」場合の扱いとして自然（roadmap.md §5 の「オーナー判断が要る6項目」に
    このパラメータは入っていない=技術側の裁量で決めてよい)。採用したのは省略可能な引数。
  - **`strength <= threshold` の場合にエラーを投げる**: 「既に閾値以下の Memory を作る」のは
    正常系であり得る（例えば `strength` を低く初期化した `imported` な Memory）。エラーに
    すると呼び出し側に余計な分岐を強制する。却下。

- **理由**:
  1. 指数減衰は half-life という語彙・列名（`half_life_hours`）と直接対応し、
     `strength * 0.5 ** (t / halfLife)` は「half-life 時間ごとに半分になる」という
     half-life の定義そのものである。
  2. `floorAt` を `strengthAt(now) = threshold` の解析解として導出することで、
     `strengthAt` と `floorAt` が同じ式から機械的に一貫する（片方を変えたらもう片方も
     追従できる関係になっている）。
  3. `strength <= threshold` の分岐を「base をそのまま返す」にすることで、`floorAt` は
     常に何らかの具体的な `Date` を返せる（例外を投げない）。呼び出し側は常に
     `decay_floor_at` に書き込む値を持てる。

- **結果（この決定が招くもの）**:
  良い面: `strengthAt` / `floorAt` が純関数として閉じ、テストしやすい
  （`packages/core/src/__tests__/decay.test.ts`）。`half_life_hours` の意味が式と一致する。

  引き受ける負債:
  - **指数減衰が実際の利用実感に合うかは未検証。** 「1週間で半分」のような直感的な
    設定はしやすいが、実データでの調整は Phase 1 の実装・運用を経ないと分からない。
  - `strength <= threshold` の境界での挙動（`<=` と `<` のどちらを使うか）は、
    `strength === threshold` の場合に限り数学的にどちらでも同じ結果になる
    （`log2(strength/threshold) = log2(1) = 0` のため）。実装上は `<=` を採ったが、
    これは境界そのものの選択であり、観測可能な違いを生まない。

- **これが覆るとしたら**:
  - 実運用で「半減期通りに減衰する」体感が実際の有用性の変化と合わないと分かったら、
    式そのもの（指数減衰以外）を再検討する。
  - 既定閾値 0.05 が「早く忘れすぎる」「遅すぎる」といった声に繋がったら、
    テナント単位・Memory 単位で閾値自体を可変にすることを検討する
    （現状は `floorAt` の引数として関数呼び出し側が渡せるため、型としては既に対応できる。
    既定値をどこに置くかだけが変わる)。

- **確かめていないこと**:
  - 指数減衰のパラメータ（half-life・閾値 0.05）が実データに対して妥当かどうかは、
    Phase 1 の実装・運用を経ないと分からない。この ADR は式の形と既定値を固定するだけであり、
    値の妥当性を検証したものではない。
