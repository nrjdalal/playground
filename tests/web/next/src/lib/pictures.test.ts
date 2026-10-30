import { describe, expect, test } from "bun:test"

import {
  foldPairs,
  type Picture,
  compareKey,
  comparePointer,
  panBy,
  zoomAt,
} from "../../../../../web/next/src/lib/pictures"

const pic = (name: string, rest: Partial<Picture> = {}): Picture => ({
  kind: "image",
  name,
  ...rest,
})

describe("foldPairs", () => {
  test("a before and an after in one group fold into one item where the earlier stood, named by the group", () => {
    const after = pic("a.png", { group: "Chat · Light", label: "after" })
    const lone = pic("lone.png")
    const before = pic("b.png", { group: "Chat · Light", label: "before" })
    expect(foldPairs([after, lone, before])).toEqual([
      { ...before, label: undefined, name: "Chat · Light", pair: { after, before } },
      lone,
    ])
  })

  test("a pair with no group is named by both files", () => {
    const before = pic("b.png", { label: "before" })
    const after = pic("a.png", { label: "after" })
    expect(foldPairs([before, after])[0].name).toBe("b.png · a.png")
  })

  test("a before and an after in different groups stay apart", () => {
    const items = [
      pic("b", { group: "Light", label: "before" }),
      pic("a", { group: "Dark", label: "after" }),
    ]
    expect(foldPairs(items)).toEqual(items)
  })

  test("befores and afters pair in turn, and a spare one stays alone", () => {
    const [b1, b2, a1, b3, a2] = ["b1", "b2", "a1", "b3", "a2"].map((name) =>
      pic(name, { label: name.startsWith("b") ? "before" : "after" }),
    )
    expect(
      foldPairs([b1, b2, a1, b3, a2]).map((item) => item.pair?.after.name ?? item.name),
    ).toEqual(["a1", "a2", "b3"])
  })

  test("only images pair", () => {
    const items = [
      pic("b.html", { kind: "html", label: "before" }),
      pic("a.png", { label: "after" }),
    ]
    expect(foldPairs(items)).toEqual(items)
  })
})

describe("compareKey", () => {
  test("the compare slider: Left and Right move 5 a press, Home and End go to the ends", () => {
    expect(compareKey(50, "ArrowRight")).toBe(55)
    expect(compareKey(50, "ArrowLeft")).toBe(45)
    // Up and Down change the slide, through the viewer's onEdge
    expect(compareKey(50, "ArrowUp")).toBeNull()
    expect(compareKey(50, "ArrowDown")).toBeNull()
    expect(compareKey(50, "Home")).toBe(0)
    expect(compareKey(50, "End")).toBe(100)
  })

  test("stays between 0 and 100", () => {
    expect(compareKey(98, "ArrowRight")).toBe(100)
    expect(compareKey(3, "ArrowLeft")).toBe(0)
  })

  test("any other key is not the slider's", () => {
    expect(compareKey(50, "Enter")).toBeNull()
    expect(compareKey(50, "a")).toBeNull()
  })
})

describe("comparePointer", () => {
  test("the pointer's share of the width, kept inside the box", () => {
    expect(comparePointer(150, { left: 100, width: 200 })).toBe(25)
    expect(comparePointer(50, { left: 100, width: 200 })).toBe(0)
    expect(comparePointer(400, { left: 100, width: 200 })).toBe(100)
  })

  test("a box with no width reads as the middle", () => {
    expect(comparePointer(100, { left: 100, width: 0 })).toBe(50)
  })
})

describe("zoomAt", () => {
  test("keeps the clicked point under the pointer", () => {
    expect(zoomAt({ x: 100, y: 50 }, { height: 200, width: 400 })).toEqual({ x: -100, y: -50 })
  })

  test("a corner zooms into that corner", () => {
    expect(zoomAt({ x: 0, y: 0 }, { height: 200, width: 400 })).toEqual({ x: 0, y: 0 })
    expect(zoomAt({ x: 400, y: 200 }, { height: 200, width: 400 })).toEqual({ x: -400, y: -200 })
  })
})

describe("panBy", () => {
  test("moves by the drag", () => {
    expect(panBy({ x: -100, y: -50 }, { x: 30, y: -20 }, { height: 200, width: 400 })).toEqual({
      x: -70,
      y: -70,
    })
  })

  test("stops where the picture's edge meets the box's", () => {
    expect(panBy({ x: -10, y: -10 }, { x: 50, y: 50 }, { height: 200, width: 400 })).toEqual({
      x: 0,
      y: 0,
    })
    expect(panBy({ x: -390, y: -190 }, { x: -50, y: -50 }, { height: 200, width: 400 })).toEqual({
      x: -400,
      y: -200,
    })
  })
})
