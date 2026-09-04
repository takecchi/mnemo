# mnemo

**既存の LLM アプリケーションの下に敷く「認知レイヤー」。**

単発の `入力 → LLM → 出力` の外側に、永続する記憶と継続する認知処理を置く。

```
Application → Agent / LLM → Cognitive Runtime → Storage / LLM / Queue
                              ├── Observation
                              ├── Memory / Recall / Association
                              ├── Reinforcement / Forgetting / Consolidation
                              └── Reflection / Background Cognition
```

**エージェントフレームワークを作り直すものではない。** LangGraph・Mastra・自作 Agent の
**下に足せる**位置を狙う。

---

## 目指しているもの

**LLM アプリケーションに「思い出す」を与えること。「保存する」ではなく。**

保存はすでに解けている。解けていないのは、
**大量に貯めたものの中から、いま必要な分だけを引き当てること**である。

**近づいたかどうかを測る物差しは一つだけ**——
**使う側が、会話ログを全部プロンプトへ積むのをやめられたか。**

→ **[docs/north-star.md](./docs/north-star.md)**（正典。目的 / 目指す姿 / 物差し / 迷ったときの問い）

---

## いまの状態

**設計フェーズ。コードはまだ無い。**

| 文書 | 何が書いてあるか |
|---|---|
| [docs/north-star.md](./docs/north-star.md) | **正典。**目指すもの・物差し・迷ったときの問い |
| [docs/vision.md](./docs/vision.md) | プロジェクトの理解 / 用語 / やらないこと / 名前 |
| [docs/architecture.md](./docs/architecture.md) | 全体アーキテクチャ / package 構成 / 主要 interface |
| [docs/memory-model.md](./docs/memory-model.md) | DB schema 案 / Memory lifecycle / 矛盾 / 忘却 / 監査ログ |
| [docs/recall.md](./docs/recall.md) | Recall pipeline / 「無い」の分類 / 目次帯 / 量の計測と予算 |
| [docs/roadmap.md](./docs/roadmap.md) | Phase 1 実装計画 / リスク / まだ判断が必要な点 |
| [docs/alteroid-findings.md](./docs/alteroid-findings.md) | 設計の材料にした運用知見を、現物で検証した記録 |
| [docs/decisions/](./docs/decisions/) | ADR — 重大な設計判断と、その理由 |

このリポジトリで作業する人・エージェント向けの手引きは [AGENTS.md](./AGENTS.md) にある。

**設計が承認されてから Phase 1 の実装に入る。**

---

## 外から見える API

```ts
observe(ctx, input)      // 起きたことを記録する
recall(ctx, query)       // 問いに対して記憶を取り出す
reflect(ctx, opts)       // 入力が無い状態で、既存の記憶から新しい記憶を作る
consolidate(ctx, opts)   // 複数の記憶を統合する
forget(ctx, target)      // 記憶を落とす / 失効させる
```

**内部が複雑でも、外側はこの5つに保つ。6つ目は作らない。**

---

## ⚠ 暫定

- **名前は仮**（`mnemo` / `@mnemo/*`）。unscoped の `mnemo` は npm に別のパッケージが既にある。
  経緯は [docs/vision.md](./docs/vision.md) の「名前について」を見ること
- **設計はまだレビュー前である。**ここに書かれていることは決定であって、実装された事実ではない
