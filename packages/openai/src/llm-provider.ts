import OpenAI from "openai";
import type { Ctx, LLMProvider, LLMResponse, PromptSpec, StructuredRequest } from "@mnemo/core";
import { translateForOpenAIStructuredOutput } from "./json-schema.js";

/**
 * `packages/openai` の `LLMProvider` 実装（docs/architecture.md §5.4・§3.8）。
 *
 * `completeStructured` がこのパッケージの中心的な責務——zod スキーマを OpenAI の
 * Structured Output（`response_format: json_schema`, strict）へ翻訳し、返ってきた
 * JSON をもう一度 zod でパースして返す。**core・呼び出し側に OpenAI SDK の型は
 * 一切現れない**（`OpenAI`/`ChatCompletion` 等の型はこのファイルの外に出ない）。
 *
 * `client` を注入できるようにしてある（`OpenAIEmbeddingProvider` と同じ理由）。
 */
export interface OpenAILLMProviderOptions {
  apiKey?: string;
  model: string;
  client?: Pick<OpenAI, "chat">;
}

/**
 * OpenAI の strict モードは「省略可能」を `null` として返す（`json-schema.ts` の翻訳が
 * そう変換しているため）。しかし core の zod スキーマは `.optional()` を使っており、
 * **`null` を受け付けない**（`z.string().optional().safeParse(null)` は失敗する。
 * `undefined`/キー省略だけを許す）。そのため、OpenAI から返った JSON をそのまま
 * `req.schema.parse` に渡すと、モデルが「省略可能なので何も無い」と判断しただけの
 * フィールドで検証エラーになってしまう。
 *
 * ここでは再帰的に `null` を「キーが無い」状態へ変換してから core のスキーマでパースする。
 * **決めたこと（PR 本文にも記載）**: この変換は「`null` は常に『値が無い』を意味する」
 * という前提に立つ。将来 `completeStructured` へ渡すスキーマが `null` を意味のある値
 * として区別したくなった場合（`.nullable()` を意図的に使う場合）、この汎用的な変換は
 * 見直しが必要になる。Phase 1 で `completeStructured` に渡す実際のスキーマ
 * （`extraction.ts` の `ExtractionResultSchema`）にはそのような区別を要するフィールドが
 * 無いことを確認済み。
 */
function stripNulls(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const stripped = stripNulls(child);
      if (stripped !== undefined) {
        result[key] = stripped;
      }
    }
    return result;
  }
  return value;
}

function toOpenAIMessages(
  prompt: PromptSpec,
): { role: "system" | "user" | "assistant"; content: string }[] {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (prompt.system) {
    messages.push({ role: "system", content: prompt.system });
  }
  for (const message of prompt.messages) {
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

export class OpenAILLMProvider implements LLMProvider {
  private readonly client: Pick<OpenAI, "chat">;
  private readonly model: string;

  constructor(options: OpenAILLMProviderOptions) {
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey });
    this.model = options.model;
  }

  async complete(_ctx: Ctx, req: PromptSpec): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(req),
    });
    return { content: response.choices[0]?.message?.content ?? "" };
  }

  async completeStructured<T>(_ctx: Ctx, req: StructuredRequest<T>): Promise<T> {
    const format = translateForOpenAIStructuredOutput("mnemo_structured_output", req.schema);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(req.prompt),
      response_format: { type: "json_schema", json_schema: format },
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("OpenAILLMProvider: structured completion returned no content");
    }
    const parsedJson: unknown = JSON.parse(raw);
    // OpenAI の strict モードは JSON Schema としての形は保証するが、それが core の zod
    // スキーマとして意味的に妥当かは別問題。上の stripNulls で null → 省略へ変換してから
    // もう一度 zod でパースし、core・呼び出し側には常に検証済みの T を返す。
    return req.schema.parse(stripNulls(parsedJson));
  }
}
