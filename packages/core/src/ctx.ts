import { z } from "zod";

/**
 * すべての interface のメソッドが第一引数に取る呼び出しコンテキスト。
 *
 * `tenantId` は隔離境界（安全性の単位）、`subjectId` はテナント内の整理の単位。
 * この非対称性を混同しない（docs/vision.md 「Tenant と Subject を混同しない」）。
 *
 * mnemora はテナントの台帳を持たない。`tenantId` は呼び出し側が渡す不透明な文字列であり、
 * 存在確認・認証は行わない（docs/architecture.md §3.7）。
 */
export interface Ctx {
  tenantId: string;
  subjectId?: string;
}

export const CtxSchema = z.object({
  tenantId: z.string().min(1),
  subjectId: z.string().min(1).optional(),
}) satisfies z.ZodType<Ctx>;
