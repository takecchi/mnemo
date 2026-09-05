import { describe, expect, it } from "vitest";
import { EmbeddingSpaceIdSchema } from "../embedding.js";

describe("EmbeddingSpaceIdSchema — D8: provider を持つ", () => {
  it("accepts provider / model / dimensions がすべて揃っている", () => {
    const result = EmbeddingSpaceIdSchema.safeParse({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    expect(result.success).toBe(true);
  });

  it("rejects provider を欠く入力（D8 以前の {model, dimensions} だけの形は通らない）", () => {
    const result = EmbeddingSpaceIdSchema.safeParse({
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    expect(result.success).toBe(false);
  });

  it("rejects dimensions が正の整数でない", () => {
    const result = EmbeddingSpaceIdSchema.safeParse({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 0,
    });
    expect(result.success).toBe(false);
  });
});
