// A PR body's shape, which ops-checks, merge-on-ready and pr:merge's Checks gate each read.

// Pure: whether a PR body is the PR template: a TL;DR of 2 sentences or more first, its bullets or its prose, then the pr skill's Summary, Evidence and Merge Danger, then Links, each a heading of its own, in that order; a TL;DR may open with an `Outcome:` label.
export function templateBody(body: string): boolean {
  const lines = body.split(/\r?\n/).filter((line) => line.trim())
  // a heading inside a code fence is a sample, not a section
  let fenced = false
  const headings = lines.map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced
    return fenced
      ? ""
      : (/^##\s+(.+?)\s*$/
          .exec(line)?.[1]
          ?.toLowerCase()
          .replace(/^tldr$/, "tl;dr") ?? "")
  })
  const at = ["tl;dr", "summary", "evidence", "merge danger", "links"].map((name) =>
    headings.indexOf(name),
  )
  const end = at[1] ?? -1
  // a bullet is a sentence of its own, its closing stop optional
  const tldr = lines
    .slice(1, end)
    .map(
      (line) =>
        /^\s*[-*+]\s+(.*)$/
          .exec(line)?.[1]
          ?.replace(/\s*$/, "")
          .replace(/(?<![.!?])$/, ".") ?? line,
    )
    .join(" ")
    .replace(/^\**Outcome\**\s*:\**\s*/, "")
  const sentences = tldr.match(/[^.!?]*\w[^.!?]*[.!?](?=\s|$)/g)?.length ?? 0
  return at[0] === 0 && at.every((i, k) => k === 0 || i > (at[k - 1] ?? -1)) && sentences >= 2
}

// Pure: the Outcome label a line of a body's TL;DR opens with, up to its next ## heading, a bullet's, a numbered item's, a quote's or a bold one included, else null.
export function tldrLabel(body: string): string | null {
  const lines = body.split(/\r?\n/)
  const at = lines.findIndex((line) => /^##\s+tl;?dr\s*$/i.test(line))
  if (at === -1) return null
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,2}\s/.test(line)) break
    const label = /^\s*(?:(?:[-*+>]|\d+[.)])\s*)?(?:\*\*|__)?(Outcome)(?:\*\*|__)?\s*:/i.exec(
      line,
    )?.[1]
    if (label) return label
  }
  return null
}

// Pure: why the gate refuses a PR's body, or null when it takes it: the PR template, its TL;DR holding no Outcome label line.
export function bodyRefusal(body: string): string | null {
  const label = tldrLabel(body)
  if (label) {
    return `its body's TL;DR holds a line labelled "${label}:", which the pr skill's template (extensions/core/skills/pr/SKILL.md) leaves out; delete that line`
  }
  if (templateBody(body)) return null
  return "its body needs the PR template: a TL;DR of 2 sentences or more, the pr skill's Summary, Evidence and Merge Danger, then Links (extensions/core/skills/pr/SKILL.md)"
}
