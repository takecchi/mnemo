// packages/testkit — adapter が満たすべき適合テスト一式（conformance suite）。
// プレースホルダ実装（__fixtures__）は意図的にここから export しない。
// adapter 作者は自分の実装を `createStore` に渡して conformance suite を走らせる。

export * from "./memory-store-conformance.js";
export * from "./vector-store-conformance.js";
export * from "./event-store-conformance.js";
export * from "./outbox-store-conformance.js";
export * from "./tenant-settings-store-conformance.js";
export * from "./test-data.js";

// roadmap.md 段階3: LLM/EmbeddingProvider の決定的な擬似実装。
// PR 本文「擬似物の扱い」の通り、これは本物の provider の代替ではない
// （CI で本物の LLM/埋め込みモデルを叩けないための擬似物であることを隠さない）。
// __fixtures__ の Store 系プレースホルダとは異なり、これらは adapter パッケージ
// （packages/postgres の実 DB 往復テスト等）から再利用されることを意図しており、
// 意図的に index.ts から export する。
export * from "./__fixtures__/deterministic-llm-provider.js";
export * from "./__fixtures__/deterministic-embedding-provider.js";
