# docs — 設計フェーズの成果物

**まだコードは無い。**ここに在るのは設計判断とその理由である。

## 読む順

| 文書 | 何が書いてあるか |
|---|---|
| [vision.md](./vision.md) | このプロジェクトの理解 / 用語整理 / やらないこと / 名前 |
| [architecture.md](./architecture.md) | 全体アーキテクチャ / package 構成 / 主要 interface |
| [memory-model.md](./memory-model.md) | DB schema 案 / Memory lifecycle / provenance / 矛盾 / 忘却 / 監査ログ |
| [recall.md](./recall.md) | Recall pipeline / 「無い」の分類 / 目次帯 / 量の計測と予算 |
| [roadmap.md](./roadmap.md) | Phase 1 実装計画 / 技術上のリスク / **まだ判断が必要な点** |
| [alteroid-findings.md](./alteroid-findings.md) | 設計の材料にした運用知見を現物で検証した記録 |
| [decisions/](./decisions/) | ADR（重大な設計判断とその理由） |

## 全体を貫く一本の原則

> **文脈を剥がして提示しない (Qualified Presentation)**

1. **争われている主張は、それを争う相手と必ず同時に提示する**（矛盾の扱い）
2. **推論は、その根拠と必ず同時に提示する**（provenance）
3. **結果は、そこから漏れたものと必ず同時に提示する**（説明可能性 / 不在の分類）

三つは別々の機能ではなく、同じ一つの規律の適用先が違うだけである。
詳細は [vision.md](./vision.md) を見ること。

## 外から見える API

`observe()` / `recall()` / `reflect()` / `consolidate()` / `forget()` の5つ。**6つ目は作らない。**

## オーナーの判断を待っている点

6項目ある。[roadmap.md](./roadmap.md) の「設計上まだ判断が必要な点」を見ること。
それ以外は**設計側で決めて、理由を ADR に残してある。**
