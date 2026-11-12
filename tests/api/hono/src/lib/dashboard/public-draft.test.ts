import { describe, expect, test } from "bun:test"

import {
  publicDraftRefusal,
  publicDraftText,
} from "../../../../../../api/hono/src/lib/dashboard/public-draft"

const PUBLIC = {
  from: "worker-envy",
  kind: "draft",
  preview: {
    noLink: "the owner posts it on the company page",
    text: "Shipping today.",
    to: "the company page",
  },
  title: "Post the launch note?",
}
const LINKED = {
  ...PUBLIC,
  preview: {
    link: "https://app.slack.com/client/T0000000000/D0MADEUP11",
    text: "hi, it shipped",
    to: "a colleague's DM",
  },
}
const runs: string[][] = []
const runWith =
  (code: number, err = "") =>
  async (argv: string[]) => {
    runs.push(argv)
    return { code, err, out: "" }
  }

describe("publicDraftText", () => {
  test("reads a draft with no link as a public post's, and no other item", () => {
    expect(publicDraftText(PUBLIC)).toBe("Shipping today.")
    expect(publicDraftText(LINKED)).toBeUndefined()
    expect(publicDraftText({ kind: "update", preview: { text: "It shipped." } })).toBeUndefined()
    expect(publicDraftText({ preview: { text: "It shipped.", type: "ask" } })).toBeUndefined()
    expect(publicDraftText({ kind: "draft", preview: { noLink: "no text yet" } })).toBeUndefined()
    expect(publicDraftText({ kind: "draft" })).toBeUndefined()
    expect(publicDraftText("not an item")).toBeUndefined()
    expect(publicDraftText(null)).toBeUndefined()
  })
})

describe("publicDraftRefusal", () => {
  test("runs the check on a public post's text alone, as a child of this bun in the checkout", async () => {
    runs.length = 0
    expect(await publicDraftRefusal(LINKED, { root: "/repo", run: runWith(2, "x") })).toBeNull()
    expect(
      await publicDraftRefusal({ kind: "update" }, { root: "/repo", run: runWith(2, "x") }),
    ).toBeNull()
    expect(runs).toEqual([])
    expect(await publicDraftRefusal(PUBLIC, { root: "/repo", run: runWith(0) })).toBeNull()
    expect(runs).toEqual([
      [process.execPath, "--no-env-file", "/repo/scripts/hooks/public-draft.ts", "Shipping today."],
    ])
  })

  test("exit 2's last stderr line is the refusal, and any other exit, or an exit 2 that names nothing, refuses too", async () => {
    const refusal = (code: number, err = "") =>
      publicDraftRefusal(PUBLIC, { root: "/repo", run: runWith(code, err) })
    expect(await refusal(2, "a warning first\na draft with no link is a public post's")).toBe(
      "a draft with no link is a public post's",
    )
    expect(await refusal(1, "error: Cannot find module")).toBe(
      "the public-draft check failed (exit 1: error: Cannot find module), so this draft posts nothing; run bun install in /repo when a module is missing, then post again",
    )
    expect(await refusal(2)).toBe(
      "the public-draft check failed (exit 2), so this draft posts nothing; run bun install in /repo when a module is missing, then post again",
    )
    expect(await publicDraftRefusal(PUBLIC, { root: null, run: runWith(0) })).toBe(
      "this ask has no checkout to run the public-draft check from",
    )
  })
})
