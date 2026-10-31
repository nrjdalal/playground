import { describe, expect, test } from "bun:test"

import { atHead, verdictOf, verdictsOf } from "../../../../packages/config/src/verdicts"

describe("a verdict comment", () => {
  test("a review reads its round, score and sha", () => {
    expect(verdictOf("## ReviewBot · round 3: 5/5 at 9d77e97 · 0 blocking")).toMatchObject({
      at: "9d77e97",
      gate: "review",
      pass: true,
      round: 3,
      score: 5,
    })
    expect(verdictOf("## ReviewBot · round 1: 4/5 at 9D77E97")).toMatchObject({
      at: "9d77e97",
      pass: false,
    })
  })

  test("a tester's word reads PASS or FAIL at its sha", () => {
    expect(verdictOf("## TesterBot · PASS at 9d77e97 · both shots attached")).toEqual({
      at: "9d77e97",
      gate: "tester",
      pass: true,
      text: "## TesterBot · PASS at 9d77e97 · both shots attached",
    })
    expect(verdictOf("\n## TesterBot · fail at 9d77e97")).toMatchObject({
      gate: "tester",
      pass: false,
    })
  })

  test("any other comment, or a verdict below its first line, reads as nothing", () => {
    expect(verdictOf("Checks: PASS @ 9d77e97 · suite green")).toBeNull()
    expect(verdictOf("Looks good to me.")).toBeNull()
    expect(verdictsOf("Shots below.\n## TesterBot · PASS at 9d77e97")).toEqual([])
  })

  test("a sha names the head when it is a prefix of it, seven characters at least", () => {
    expect(atHead("9d77e97", "9d77e97a1b2c")).toBe(true)
    expect(atHead("9d77e9", "9d77e97a1b2c")).toBe(false)
    expect(atHead("1111111", "9d77e97a1b2c")).toBe(false)
  })
})
