import type { z } from "zod";
import type { Ctx } from "../ctx.js";

/**
 * core は OpenAI SDK・Anthropic SDK のどちらの型も import しない
 * （docs/architecture.md §3.8）。provider 非依存の最小限の型のみ持つ。
 */
export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptSpec {
  system?: string;
  messages: PromptMessage[];
}

export interface LLMResponse {
  content: string;
}

export interface StructuredRequest<T> {
  prompt: PromptSpec;
  /** core は zod でスキーマを記述するだけ。ベンダー固有の Structured Output 形式への
   * 翻訳は各 provider package の責務（docs/architecture.md §3.8）。 */
  schema: z.ZodType<T>;
}

/**
 * LLMProvider — Phase 1（docs/architecture.md §5.4）。
 *
 * 契約:
 * - `completeStructured` はベンダー固有の Structured Output 機構へ翻訳する義務を negate
 *   できない。core・呼び出し側に OpenAI/Anthropic SDK の型を漏らしてはならない。
 * - タイムアウト・レート制限・失敗時は例外を投げる。`LLMProvider` 自体はリトライを
 *   内蔵しない（責務の混在を避ける）。
 */
export interface LLMProvider {
  complete(ctx: Ctx, req: PromptSpec): Promise<LLMResponse>;
  completeStructured<T>(ctx: Ctx, req: StructuredRequest<T>): Promise<T>;
}
