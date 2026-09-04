import { describe, expect, it } from "vitest";
import { heuristicTokenCounter } from "../heuristic-token-counter.js";

describe("heuristicTokenCounter", () => {
  it("常に counter: 'heuristic' を返す", () => {
    expect(heuristicTokenCounter.count("hello").counter).toBe("heuristic");
  });

  it("空文字は 0 トークン", () => {
    expect(heuristicTokenCounter.count("").tokens).toBe(0);
  });

  it("文字数 / 4 を切り上げた値を返す（非空文字）", () => {
    expect(heuristicTokenCounter.count("abcdefgh").tokens).toBe(2);
    expect(heuristicTokenCounter.count("abcde").tokens).toBe(2);
  });
});
