/**
 * 識別子の型エイリアス。
 *
 * 現時点ではただの `string` だが、名前を分けることで interface のシグネチャが
 * 「何の識別子を渡すべきか」を読み手に伝える（docs/architecture.md §5 各所で
 * `MemoryId` 等の名前が使われている）。
 */
export type MemoryId = string;
export type ObservationId = string;
export type EventId = string;
export type RecallId = string;
