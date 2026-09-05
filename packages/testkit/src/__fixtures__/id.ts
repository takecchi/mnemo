let counter = 0;

/** テストのためだけの単純な連番 id 生成。本物の adapter はこの方式を真似る必要はない。 */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
