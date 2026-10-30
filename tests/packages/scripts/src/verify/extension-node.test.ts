import { describe, expect, test } from "bun:test"

import { readCheck, strayRoutes } from "../../../../../packages/scripts/src/verify/checks"
import {
  EXTENSION_NODE_SCRIPT,
  extensionNodeResult,
} from "../../../../../packages/scripts/src/verify/extension-node"

describe("extensionNodeResult", () => {
  test("passes a page whose overlay counts no issue with the node in body", () => {
    expect(
      extensionNodeResult("/dashboard", {
        before: ["div", "script"],
        issues: { count: 0, labels: [] },
      }),
    ).toEqual({
      check: "extension-node /dashboard",
      detail: "hydrates clean with the node after div script",
      ok: true,
    })
  })

  test("names the overlay's issues when the node breaks hydration (#2086)", () => {
    expect(
      extensionNodeResult("/dashboard/system", {
        before: ["div", "script"],
        issues: { count: 2, labels: ["Console Error"] },
      }),
    ).toEqual({
      check: "extension-node /dashboard/system",
      detail: "2 issues in Next's overlay with the node after div script: Console Error",
      ok: false,
    })
  })

  test("fails a load the node never reached, or one with no overlay to read", () => {
    expect(extensionNodeResult("/dashboard", { before: null, issues: null }).detail).toBe(
      "the node never landed in body",
    )
    expect(extensionNodeResult("/dashboard", { before: ["div"], issues: null }).detail).toBe(
      "no Next.js dev overlay to read issues from",
    )
  })
})

test("the node is Scrnli's: a div#scrnli_recorder_root with a shadow root, after body's first script", () => {
  expect(EXTENSION_NODE_SCRIPT).toContain(`node.id = "scrnli_recorder_root"`)
  expect(EXTENSION_NODE_SCRIPT).toContain(`attachShadow({ mode: "open" })`)
  expect(EXTENSION_NODE_SCRIPT).toContain("script.after(node)")
})

test("extension-node is a check that takes routes", () => {
  expect(readCheck(["extension-node", "/dashboard"])).toEqual({
    check: "extension-node",
    routes: ["/dashboard"],
  })
  expect(strayRoutes("extension-node", ["/dashboard"])).toBeNull()
})
