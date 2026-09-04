// このファイルが roadmap.md 段階1の完了条件そのものにあたる:
// 「testkit の適合テストの雛形（2テナント分のデータを入れて走らせる枠組み）が、
//   プレースホルダ実装に対して動く」

import { describeEventStoreConformance } from "../event-store-conformance.js";
import { describeMemoryStoreConformance } from "../memory-store-conformance.js";
import { describeVectorStoreConformance } from "../vector-store-conformance.js";
import { InMemoryEventStore } from "../__fixtures__/in-memory-event-store.js";
import { InMemoryMemoryStore } from "../__fixtures__/in-memory-memory-store.js";
import { InMemoryVectorStore } from "../__fixtures__/in-memory-vector-store.js";

describeMemoryStoreConformance({
  name: "in-memory placeholder",
  createStore: () => new InMemoryMemoryStore(),
});

describeVectorStoreConformance({
  name: "in-memory placeholder",
  createStore: () => new InMemoryVectorStore(),
});

describeEventStoreConformance({
  name: "in-memory placeholder",
  createStore: () => new InMemoryEventStore(),
});
