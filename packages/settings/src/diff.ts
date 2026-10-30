import { createHash } from "node:crypto"

// JSON with every object's keys sorted and two-space indents, so two exports of the same rows are the same bytes and diff item by item.
export const stableJson = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, sortKeys(item)]),
        )
      : value

export const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex")

export type RevisionContent = { body: string | null; files: unknown; meta: unknown; value: unknown }

// A revision's sha256, over its content alone, so the same content hashes the same on every machine.
export const revisionSha = ({ body, files, meta, value }: RevisionContent): string =>
  sha256(stableJson({ body, files, meta, value }))

// A revision's content as the lines a diff compares: a body as it is, any other part as its stable JSON under a heading.
export const revisionLines = (content: RevisionContent): string[] => [
  ...(content.body === null ? [] : content.body.split("\n")),
  ...(["files", "value", "meta"] as const).flatMap((part) =>
    content[part] === null || content[part] === undefined
      ? []
      : [`[${part}]`, ...stableJson(content[part]).trimEnd().split("\n")],
  ),
]

// A line diff of two texts, computed on read since every revision is a whole copy: "- " for a line only in a, "+ " for one only in b, and two lines of context around each change, a gap marked "@@".
export const lineDiff = (a: string[], b: string[], context = 2): string[] => {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const ops: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) (ops.push(`  ${a[i++]}`), j++)
    else if (j < b.length && (i === a.length || lcs[i]![j + 1]! > lcs[i + 1]![j]!))
      ops.push(`+ ${b[j++]}`)
    else ops.push(`- ${a[i++]}`)
  }
  if (ops.every((op) => op.startsWith("  "))) return []
  const near = ops.map((_, k) =>
    ops.slice(Math.max(0, k - context), k + context + 1).some((op) => !op.startsWith("  ")),
  )
  return ops.flatMap((op, k) =>
    near[k] ? [op] : near[k - 1] || (k === 0 && ops.length > 0) ? ["@@"] : [],
  )
}
