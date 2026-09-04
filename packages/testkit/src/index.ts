// packages/testkit — adapter が満たすべき適合テスト一式（conformance suite）。
// プレースホルダ実装（__fixtures__）は意図的にここから export しない。
// adapter 作者は自分の実装を `createStore` に渡して conformance suite を走らせる。

export * from "./memory-store-conformance.js";
export * from "./vector-store-conformance.js";
export * from "./event-store-conformance.js";
export * from "./test-data.js";
