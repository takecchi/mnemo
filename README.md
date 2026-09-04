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

## いまの状態

**設計フェーズ。コードはまだ無い。**

- `docs/` に vision / architecture / memory-model / recall / roadmap
- `docs/decisions/` に ADR

**設計が承認されてから Phase 1 の実装に入る。**

## ⚠ 暫定

- **名前は仮**（`mnemo` / `@mnemo/*`）。公開前に確定させる
- **private で作成した。**公開範囲はオーナーの判断であり、
  private → public は後からできるが逆は取り返しがつかないため、安全な側に倒してある
