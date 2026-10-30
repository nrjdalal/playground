import remarkGfm from "remark-gfm"
import remarkMdx from "remark-mdx"
import remarkParse from "remark-parse"
import { unified } from "unified"

type Node = { [key: string]: unknown; children?: Node[]; position?: unknown; value?: unknown }

// The file as Markdown reads it, with no positions and every run of whitespace in a text value as one space, since a soft line break and a space render alike.
export function rendered(text: string, mdx: boolean): string {
  const parser = unified().use(remarkParse).use(remarkGfm)
  if (mdx) parser.use(remarkMdx)
  const strip = (node: Node): Node => {
    const { children, position: _, ...rest } = node
    const out: Node = { ...rest }
    if (typeof out.value === "string" && (node.type === "text" || node.type === "inlineCode"))
      out.value = out.value.replace(/\s+/g, " ")
    if (children) out.children = children.map(strip)
    return out
  }
  return JSON.stringify(strip(parser.parse(text) as unknown as Node))
}

// Why `after` is not `before` rewrapped, or undefined when it is: the same characters but whitespace, and the same rendered tree.
export function differs(before: string, after: string, mdx: boolean): string | undefined {
  if (before.replace(/\s/g, "") !== after.replace(/\s/g, "")) return "its characters changed"
  if (rendered(before, mdx) !== rendered(after, mdx)) return "its rendered text changed"
  return undefined
}
