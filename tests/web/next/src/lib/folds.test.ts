import { describe, expect, test } from "bun:test"

import { keepPicks, openFolds, pickFolds, type Picks } from "../../../../../web/next/src/lib/folds"

const none: Picks = new Map()

describe("an accordion whose items start open or folded by their own state", () => {
  test("each item starts as its state says, until he picks", () => {
    expect(
      openFolds(
        [
          { id: "a", open: true },
          { id: "b", open: false },
        ],
        none,
      ),
    ).toEqual(["a"])
  })

  test("his pick holds while the item's state stays", () => {
    const folds = [
      { id: "a", open: true },
      { id: "b", open: false },
    ]
    const picks = pickFolds(folds, none, ["b"])
    expect(openFolds(folds, picks)).toEqual(["b"])
  })

  test("an item whose state changes takes its own start again", () => {
    const folded = pickFolds([{ id: "a", open: true }], none, [])
    expect(openFolds([{ id: "a", open: true }], folded)).toEqual([])
    const answered = keepPicks([{ id: "a", open: false }], folded)
    expect(answered.size).toBe(0)
    expect(openFolds([{ id: "a", open: true }], answered)).toEqual(["a"])
  })

  test("keeps every pick whose item is still there in the state it was picked in", () => {
    const picks = pickFolds([{ id: "a", open: true }], none, [])
    expect(keepPicks([{ id: "a", open: true }], picks)).toBe(picks)
    expect(keepPicks([], picks).size).toBe(0)
  })

  test("a pick records only the item he toggled, so the others keep following their state", () => {
    const folds = [
      { id: "a", open: true },
      { id: "b", open: true },
    ]
    const picks = pickFolds(folds, none, ["a"])
    expect([...picks.keys()]).toEqual(["b"])
    expect(openFolds([{ id: "a", open: false }, folds[1]!], picks)).toEqual([])
  })
})
