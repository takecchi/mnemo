/**
 * 決定的な合成会話（PR 本文「量の比較」の再現性の要）。
 *
 * 実在の会話ログを使わない代わりに、固定の乱数無し生成関数を置く——同じ長さを指定すれば
 * 誰が実行しても同じ会話・同じ文字数になる。長さを変えて数点測る、という PR の要求は
 * これが無いと再現できない。
 */

export interface ConversationTurn {
  index: number;
  role: "user" | "assistant";
  text: string;
}

export interface Conversation {
  /** 事実の表明 + filler の往復。naive path はこれを丸ごとプロンプトへ積む。 */
  turns: ConversationTurn[];
  /** mnemora path が observe() する対象（user の発話のみ。決めたことは README 参照）。 */
  userUtterances: ConversationTurn[];
  /** 終盤に置く、冒頭の事実を参照する質問。recall() の query に使う。 */
  query: string;
}

/** 冒頭で一度だけ表明される、後から参照される事実。すべての会話長で共通に固定する。 */
export const FACT_STATEMENT = "私の好きな色は青です。誕生日は4月3日です。";
const FACT_ACK = "覚えておきますね。";
export const QUERY_TEXT = "ところで、わたしの好きな色を覚えていますか?";

const FILLER_USER_LINES = [
  "今日はいい天気ですね。",
  "お昼ご飯は何を食べようか迷っています。",
  "最近見た映画の感想を話したいです。",
  "週末は友達と出かける予定です。",
  "新しい趣味を始めようと思っています。",
  "仕事の進捗について相談したいことがあります。",
  "最近読んだ本がとても面白かったです。",
  "旅行の計画を立てています。",
  "運動不足を感じているので何か始めたいです。",
  "最近のニュースについてどう思いますか。",
  "料理のレシピを教えてほしいです。",
  "ペットの調子があまり良くないので心配です。",
];

const FILLER_ASSISTANT_LINES = [
  "そうですね、良い一日になりそうです。",
  "軽めのものはいかがでしょうか。",
  "ぜひ聞かせてください。",
  "楽しんできてくださいね。",
  "それは良い挑戦だと思います。",
  "詳しく教えていただけますか。",
  "どんな内容の本でしたか。",
  "どこへ行く予定ですか。",
  "軽い運動から始めるのがおすすめです。",
  "どのニュースのことでしょうか。",
  "得意な食材はありますか。",
  "早めに病院で診てもらうと安心です。",
];

/**
 * `fillerPairs` 組の filler な user/assistant 往復を、冒頭の事実表明の後に積んだ会話を作る。
 *
 * @param fillerPairs filler の往復数。0以上の整数。
 */
export function buildConversation(fillerPairs: number): Conversation {
  if (!Number.isInteger(fillerPairs) || fillerPairs < 0) {
    throw new Error(
      `buildConversation: fillerPairs は 0 以上の整数である必要がある（実際: ${fillerPairs}）`,
    );
  }

  const turns: ConversationTurn[] = [];
  let index = 0;
  turns.push({ index: index++, role: "user", text: FACT_STATEMENT });
  turns.push({ index: index++, role: "assistant", text: FACT_ACK });
  for (let i = 0; i < fillerPairs; i += 1) {
    turns.push({
      index: index++,
      role: "user",
      text: FILLER_USER_LINES[i % FILLER_USER_LINES.length]!,
    });
    turns.push({
      index: index++,
      role: "assistant",
      text: FILLER_ASSISTANT_LINES[i % FILLER_ASSISTANT_LINES.length]!,
    });
  }

  return {
    turns,
    userUtterances: turns.filter((t) => t.role === "user"),
    query: QUERY_TEXT,
  };
}
