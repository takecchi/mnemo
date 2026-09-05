import { describe, expect, it } from "vitest";
import { FACT_STATEMENT, QUERY_TEXT, buildConversation } from "../scenario.js";

describe("buildConversation", () => {
  it("fillerPairs=0 なら事実表明の往復1組だけになる", () => {
    const conversation = buildConversation(0);
    expect(conversation.turns).toHaveLength(2);
    expect(conversation.turns[0]).toMatchObject({ role: "user", text: FACT_STATEMENT });
    expect(conversation.userUtterances).toHaveLength(1);
    expect(conversation.query).toBe(QUERY_TEXT);
  });

  it("fillerPairs=N なら往復 (1+N) 組、user 発話は (1+N) 件になる", () => {
    const conversation = buildConversation(5);
    expect(conversation.turns).toHaveLength(2 * (1 + 5));
    expect(conversation.userUtterances).toHaveLength(1 + 5);
  });

  it("filler の行は用意した候補を巡回して使う（同じ会話を2回作れば同じ文字列になる=決定的）", () => {
    const a = buildConversation(20);
    const b = buildConversation(20);
    expect(a.turns.map((t) => t.text)).toEqual(b.turns.map((t) => t.text));
  });

  it("turn の index は 0 始まりの連番", () => {
    const conversation = buildConversation(3);
    conversation.turns.forEach((turn, i) => {
      expect(turn.index).toBe(i);
    });
  });

  it("fillerPairs が負・非整数なら例外を投げる", () => {
    expect(() => buildConversation(-1)).toThrow(/0 以上の整数/);
    expect(() => buildConversation(1.5)).toThrow(/0 以上の整数/);
  });
});
