import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  CHECKS,
  stampText,
  verdictOf,
  type StampKeys,
} from "../../../../packages/config/src/verdicts"

const SHA = "9d77e97a1b2c3d4e5f60718293a4b5c6d7e8f901"

const keys: StampKeys = {
  checks: {
    build: { source: "18234567890", status: "pass" },
    verify: { comment: "The diff has no dashboard code.", source: "local", status: "skip" },
  },
  commit: SHA,
  remark: "The claim skill frontmatter test failed.",
  status: "red",
}

describe("the stamp's YAML block", () => {
  test("renders every key in a fixed order, and parses back to the same keys", () => {
    const text = stampText(keys)
    expect(text).toBe(
      [
        "```yaml",
        "status: red",
        "commit: 9d77e97",
        "checks:",
        "  build:",
        "    status: pass",
        "    source: 18234567890",
        "  verify:",
        "    status: skip",
        "    source: local",
        "    comment: The diff has no dashboard code.",
        "remark: The claim skill frontmatter test failed.",
        "```",
      ].join("\n"),
    )
    expect(verdictOf(text)).toEqual({
      at: "9d77e97",
      gate: "stamp",
      pass: false,
      stamp: { ...keys, commit: "9d77e97" },
      text: "red @ 9d77e97 · 18234567890, local",
    })
  })

  test("a block with no remark or comment anywhere, and one with no checks, round-trips", () => {
    const bare: StampKeys = {
      checks: { "agent-review": { source: "agent", status: "pass" } },
      commit: "9d77e97",
      status: "green",
    }
    expect(verdictOf(stampText(bare))?.stamp).toEqual(bare)
    const none: StampKeys = { checks: {}, commit: "9d77e97", status: "wait" }
    expect(stampText(none)).toContain("checks: {}")
    expect(verdictOf(stampText(none))?.stamp).toEqual(none)
    expect(verdictOf(stampText(none))?.pass).toBe(false)
  })

  test("the writer refuses a remark or comment over 20 words, an empty one, a line break, or a source out of its list", () => {
    const long = Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ")
    expect(() => stampText({ ...keys, remark: long })).toThrow("1 to 20 words")
    expect(() => stampText({ ...keys, remark: " " })).toThrow("1 to 20 words")
    expect(() => stampText({ ...keys, remark: "One.\nTwo." })).toThrow("1 to 20 words")
    const check = { comment: long, source: "local", status: "fail" as const }
    expect(() => stampText({ ...keys, checks: { lint: check } })).toThrow("1 to 20 words")
    expect(() =>
      stampText({ ...keys, checks: { "a b": { source: "local", status: "pass" } } }),
    ).toThrow("is one word")
    for (const [name, source] of [
      ["agent-review", "local"],
      ["agent-drive", "18234567890"],
      ["test:skills", "agent"],
      ["verify", "agent"],
    ])
      expect(() => stampText({ ...keys, checks: { [name]: { source, status: "pass" } } })).toThrow(
        "only one, has source agent",
      )
    const paired = stampText({
      ...keys,
      checks: { "agent-review": { source: "agent", status: "pass" } },
    })
    expect(verdictOf(paired.replace("    source: agent", "    source: local"))).toBeNull()
    for (const source of ["github", "self-hosted", "review", "local now"])
      expect(() => stampText({ ...keys, checks: { lint: { source, status: "pass" } } })).toThrow(
        "a GitHub run id, local or agent",
      )
  })

  test("the parser refuses a missing key, an unknown value, a long comment or any extra line", () => {
    const text = stampText(keys)
    const without = (line: string) => text.replace(`${line}\n`, "")
    expect(verdictOf(without("commit: 9d77e97"))).toBeNull()
    expect(verdictOf(without("    source: local"))).toBeNull()
    expect(verdictOf(text.replace("status: red", "status: amber"))).toBeNull()
    expect(verdictOf(text.replace("    source: local", "    source: laptop"))).toBeNull()
    expect(verdictOf(text.replace("    status: skip", "    status: maybe"))).toBeNull()
    expect(verdictOf(text.replace("commit: 9d77e97", "commit: main"))).toBeNull()
    const long = Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ")
    expect(verdictOf(text.replace("frontmatter test failed.", long))).toBeNull()
    expect(verdictOf(text.replace(/```$/, "extra: 1\n```"))).toBeNull()
    expect(verdictOf(text.replace("commit: 9d77e97\n", "commit: 9d77e97\nextra: 1\n"))).toBeNull()
    expect(verdictOf(text.replace("\nremark: ", "\ncomment: "))).toBeNull()
    expect(verdictOf(text.replace("```yaml", "```"))).toBeNull()
    expect(verdictOf(text.slice(0, -3))).toBeNull()
  })

  test("a stamp in an older shape, with runner, run or note, is refused, so it never reads green", () => {
    const text = stampText({ ...keys, status: "green" })
    expect(verdictOf(text)?.pass).toBe(true)
    const older = [
      text.replace("commit: 9d77e97\n", "commit: 9d77e97\nrunner: local\n"),
      text.replaceAll("    source: ", "    run: "),
      text.replace("\nremark: ", "\nnote: "),
      [
        "```yaml",
        "status: green",
        "commit: 9d77e97",
        "runner: self-hosted",
        "checks:",
        "  test:skills:",
        "    status: pass",
        "    run: 18234567890",
        "note: The jobs passed.",
        "```",
      ].join("\n"),
    ]
    for (const body of older) expect(verdictOf(body)).toBeNull()
  })

  test("a review comment still reads as a review, and any other comment reads as nothing", () => {
    expect(verdictOf("## ReviewBot · round 3: 5/5 at 9d77e97 · 0 blocking")).toMatchObject({
      at: "9d77e97",
      gate: "review",
      pass: true,
      round: 3,
    })
    expect(verdictOf("Checks: PASS @ 9d77e97 · suite green")).toBeNull()
    expect(verdictOf("Looks good to me.")).toBeNull()
  })

  test("checks.py names the checks CHECKS does", async () => {
    const py = await Bun.file(
      join(import.meta.dir, "..", "..", "..", "..", "scripts/ops/checks/checks.py"),
    ).text()
    const line =
      /^AGENT_DRIVE_CHECK, AGENT_REVIEW_CHECK, TRAIN_CHECK, VERIFY_CHECK = (.*)$/m.exec(py)?.[1] ??
      ""
    expect([...line.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([
      CHECKS.drive,
      CHECKS.review,
      CHECKS.train,
      CHECKS.verify,
    ])
  })
})
