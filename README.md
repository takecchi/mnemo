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

特定のチャットボット専用ではなく、Web アプリ・AI 秘書・Discord Bot・ゲーム NPC・
コーディングエージェント・ロボット・個人 AI・業務エージェントから再利用できる汎用基盤を目指す。

## 何をするものか

大量の会話ログを毎回 LLM へ全部渡すのではなく、**必要な記憶だけを**
意味・構造・時間・重要度・利用頻度・関連性から思い出す。

そこから新しい知識を統合し、使われない記憶は自然に想起されにくくなり、
必要なときだけ過去の記憶を呼び戻せる。

外から見える API は小さく保つ:

```ts
await brain.observe({ type: 'message', actor: 'user', content: '...' })
const recalled = await brain.recall({ query: '...' })
const thought = await brain.reflect()
await brain.consolidate()
await brain.forget()
```

## いまの状態

**設計フェーズ。実装コードはまだ無い。**

- `docs/` — vision / architecture / memory-model / recall / roadmap
- `docs/decisions/` — ADR

**設計が固まってから Phase 1（Observation / Memory / PostgreSQL + pgvector / `observe()` /
`recall()` / スコアの内訳と説明）の実装に入る。**

## ⚠ 暫定

**名前（`mnemo` / `@mnemo/*`）は仮である。**変わる可能性がある。
