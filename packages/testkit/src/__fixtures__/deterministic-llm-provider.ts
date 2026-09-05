import type { Ctx, LLMProvider, LLMResponse, PromptSpec, StructuredRequest } from "@mnemo/core";

/**
 * `LLMProvider` の決定的な擬似実装（roadmap.md 段階3・PR 本文「擬似物の扱い」）。
 *
 * **正直に書く**: これは本物の LLM を模したものではない。`packages/openai` の
 * `OpenAILLMProvider` を CI で本物に対して検査することはできない（API キーが無い）ため、
 * `runtime.ts`（core）や `packages/postgres` の実 DB 往復テストは、この決定的な擬似物に
 * 差し替えて検査する。**同じ入力には常に同じ出力を返す**（LLM 呼び出しの非決定性を
 * テストに持ち込まない）。
 *
 * この実装は `extraction.ts` の `ExtractionResultSchema`（`{ memories: [...] }`）の形しか
 * 知らない。それ以外のスキーマを渡された場合は例外を投げる——「知らない形に遭遇したら
 * 黙って何か返す」ことをしない（原則の姿3の適用）。
 */
export class DeterministicLLMProvider implements LLMProvider {
  async complete(_ctx: Ctx, req: PromptSpec): Promise<LLMResponse> {
    const lastMessage = req.messages[req.messages.length - 1];
    return { content: lastMessage?.content ?? "" };
  }

  async completeStructured<T>(_ctx: Ctx, req: StructuredRequest<T>): Promise<T> {
    const userText = req.prompt.messages.find((m) => m.role === "user")?.content ?? "";
    const digest = userText.length > 40 ? `${userText.slice(0, 40)}…` : userText;
    const candidate = {
      memories: [
        {
          content: userText,
          digest,
          tags: [],
          provenanceKind: "stated" as const,
        },
      ],
    };
    const parsed = req.schema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        "DeterministicLLMProvider: 未対応のスキーマが渡された（extraction.ts の " +
          "ExtractionResultSchema 以外の形には対応していない）: " +
          parsed.error.message,
      );
    }
    return parsed.data;
  }
}
