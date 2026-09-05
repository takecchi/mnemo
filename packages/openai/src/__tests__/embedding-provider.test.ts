import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@mnemo/core";
import { OpenAIEmbeddingProvider } from "../embedding-provider.js";

/**
 * **正直に書く**: ここで注入する `client` は本物の OpenAI SDK ではない。
 * ネットワーク往復（HTTP・認証・リトライ）は検査しておらず、検査しているのは
 * 「`OpenAIEmbeddingProvider` が受け取ったレスポンスをどう core の型へ変換するか」
 * という、このパッケージが実際に書いたロジックの部分だけである。
 * 本物の OpenAI に対する検査は `live.openai.test.ts`（`OPENAI_API_KEY` がある場合のみ）に分離する。
 */
const ctx: Ctx = { tenantId: "tenant-1" };

describe("OpenAIEmbeddingProvider", () => {
  it("space は provider/model/dimensions で固定される（D8・§5.5）", () => {
    const provider = new OpenAIEmbeddingProvider({
      model: "text-embedding-3-small",
      dimensions: 4,
      client: { embeddings: { create: vi.fn() } } as never,
    });
    expect(provider.space).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 4,
    });
  });

  it("embed は空配列に対して client を呼ばずに空配列を返す", async () => {
    const create = vi.fn();
    const provider = new OpenAIEmbeddingProvider({
      model: "text-embedding-3-small",
      dimensions: 4,
      client: { embeddings: { create } } as never,
    });
    const result = await provider.embed(ctx, []);
    expect(result).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("embed はレスポンスの index 順に並べ替えてベクトルを返す（順序を暗黙に信頼しない）", async () => {
    const create = vi.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: [0.2, 0.2] },
        { index: 0, embedding: [0.1, 0.1] },
      ],
      model: "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 2, total_tokens: 2 },
    });
    const provider = new OpenAIEmbeddingProvider({
      model: "text-embedding-3-small",
      dimensions: 2,
      client: { embeddings: { create } } as never,
    });

    const result = await provider.embed(ctx, ["a", "b"]);
    expect(result).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["a", "b"],
      dimensions: 2,
    });
  });
});
