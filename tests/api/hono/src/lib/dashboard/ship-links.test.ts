import { describe, expect, test } from "bun:test"

import { linkShipPrs, repoOfRemote } from "../../../../../../api/hono/src/lib/dashboard/ship-links"

const ship = {
  kind: "decision",
  preview: { prs: [{ number: 270, title: "x" }], sha: "3f9a2c1", type: "ship" },
  title: "Ship canary 3f9a2c1 to main?",
}

describe("a ship decision's PR links", () => {
  test("each PR it lists links into the factory's repo", () => {
    expect(linkShipPrs(ship, "acme/app")).toEqual({
      ...ship,
      preview: {
        ...ship.preview,
        prs: [{ number: 270, title: "x", url: "https://github.com/acme/app/pull/270" }],
      },
    })
  })

  test("no repo, or another kind, leaves the item as it came", () => {
    expect(linkShipPrs(ship, "")).toBe(ship)
    const ask = { kind: "decision", preview: { text: "See #1000.", type: "ask" } }
    expect(linkShipPrs(ask, "acme/app")).toBe(ask)
    expect(linkShipPrs("not an item", "acme/app")).toBe("not an item")
  })

  test("a GitHub remote reads as owner/name, over https or ssh, and any other as none", () => {
    expect(repoOfRemote("https://github.com/acme/app.git\n")).toBe("acme/app")
    expect(repoOfRemote("git@github.com:acme/app.git")).toBe("acme/app")
    expect(repoOfRemote("https://gitlab.com/acme/app.git")).toBe("")
  })
})
