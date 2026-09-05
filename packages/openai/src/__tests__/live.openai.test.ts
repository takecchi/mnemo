import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OpenAIEmbeddingProvider } from "../embedding-provider.js";
import { OpenAILLMProvider } from "../llm-provider.js";

/**
 * live テスト（`OPENAI_API_KEY` がある場合のみ実行、PR 本文「擬似物の扱い」参照）。
 *
 * **CI では走らない。** GitHub Actions のワークフローに `OPENAI_API_KEY` は設定していない
 * ため、CI 上ではこの `describe` ブロックが常に `skipped` として表示される
 * （`it.skipIf` を使う——`describe.skip` や「ファイル自体を読み込まない」形にはしない。
 * これは「skip ではなく走っていないと分かる形にする」という要求を、
 * vitest のレポートに「このテストの名前・このテストが skip されたこと」を必ず出す、
 * という形で満たすための選択である。テスト名を消してしまう `if (!apiKey) return` は
 * 採らない——それだと「1件パスした」という誤った印象を残す）。
 *
 * ローカルで実行するには:
 *   OPENAI_API_KEY=sk-... pnpm --filter @mnemo/openai test
 */
const apiKey = process.env.OPENAI_API_KEY;

describe("live: OpenAI (OPENAI_API_KEY が無い場合はこの describe 自体が skipped と表示される)", () => {
  it.skipIf(!apiKey)("OpenAIEmbeddingProvider.embed が実際の次元数のベクトルを返す", async () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey,
      model: "text-embedding-3-small",
      dimensions: 64,
    });
    const [vector] = await provider.embed({ tenantId: "live-test" }, ["mnemo live test"]);
    expect(vector).toHaveLength(64);
  });

  it.skipIf(!apiKey)(
    "OpenAILLMProvider.completeStructured が実際の Structured Output を返す",
    async () => {
      const provider = new OpenAILLMProvider({ apiKey, model: "gpt-4o-mini" });
      const schema = z.object({
        greeting: z.string(),
        isFriendly: z.boolean().optional(),
      });
      const result = await provider.completeStructured(
        { tenantId: "live-test" },
        {
          prompt: {
            system: "You return a short greeting as structured JSON.",
            messages: [{ role: "user", content: "Say hello in one short sentence." }],
          },
          schema,
        },
      );
      expect(typeof result.greeting).toBe("string");
      expect(result.greeting.length).toBeGreaterThan(0);
    },
  );
});
