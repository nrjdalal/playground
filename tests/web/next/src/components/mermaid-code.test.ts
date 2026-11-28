import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { DRAW } from "../../../../../web/next/src/components/mermaid-code"

// Pele resolves from the web app's own packages, which this directory cannot see; the one call the test makes is typed here.
type Drawn = { svg: string; type: string }
const web = join(import.meta.dir, "../../../../../web/next")
const { renderAsync } = (await import(Bun.resolveSync("pele/lazy", web))) as {
  renderAsync: (text: string, options?: object) => Promise<Drawn>
}

// Made-up diagrams, as an Inbox card would carry them.
const FLOW = "flowchart LR\n  ask[Ask posted] --> card[Inbox card]\n  card --> answer[Answer sent]"
const SEQUENCE =
  "sequenceDiagram\n  participant Worker\n  participant Inbox\n  Worker->>Inbox: post an ask\n  Inbox-->>Worker: the answer"
const BROKEN = "flowchart LR\n  ask[Ask posted --> card"

describe("a mermaid block Pele draws (PG-1252)", () => {
  test("a flowchart and a sequence diagram draw as SVG", async () => {
    for (const [text, type] of [
      [FLOW, "flowchart"],
      [SEQUENCE, "sequence"],
    ] as const) {
      const drawn = await renderAsync(text, DRAW)
      expect(drawn.type).toBe(type)
      expect(drawn.svg.startsWith("<svg")).toBe(true)
    }
  })

  test("a block that fails to parse throws, so the card keeps its plain code block", async () => {
    expect(renderAsync(BROKEN, DRAW)).rejects.toThrow()
  })

  test("a diagram's link or image loads nothing from elsewhere", async () => {
    const drawn = await renderAsync(
      `${FLOW}\n  click card href "https://evil.example/leak?secret=1"\n  img@{ img: "https://evil.example/leak.png" }`,
      DRAW,
    )
    expect(drawn.svg).not.toContain("evil.example")
  })
})
