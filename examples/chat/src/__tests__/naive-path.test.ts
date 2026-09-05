import { describe, expect, it } from "vitest";
import { heuristicTokenCounter } from "@mnemora/core";
import { buildConversation } from "../scenario.js";
import { measureNaive, naivePrompt } from "../naive-path.js";

describe("naivePrompt / measureNaive", () => {
  it("全ターンを role: text の形で改行区切りに連結する", () => {
    const conversation = buildConversation(0);
    const prompt = naivePrompt(conversation);
    expect(prompt.split("\n")).toEqual(conversation.turns.map((t) => `${t.role}: ${t.text}`));
  });

  it("会話が長くなるほど naive の chars/tokens は単調に増える", () => {
    const short = measureNaive(buildConversation(0), heuristicTokenCounter);
    const long = measureNaive(buildConversation(20), heuristicTokenCounter);
    expect(long.chars).toBeGreaterThan(short.chars);
    expect(long.estimatedTokens).toBeGreaterThan(short.estimatedTokens);
    expect(long.counter).toBe("heuristic");
  });

  it("chars は naivePrompt の文字列長と一致する（別々に数え直して食い違わないことの確認）", () => {
    const conversation = buildConversation(7);
    const measurement = measureNaive(conversation, heuristicTokenCounter);
    expect(measurement.chars).toBe(naivePrompt(conversation).length);
  });
});
