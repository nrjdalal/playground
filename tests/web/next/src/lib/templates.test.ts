import { describe, expect, test } from "bun:test"

import { type TemplateRow, templateRowView } from "../../../../../web/next/src/lib/templates"

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  id: "orchestrator",
  backend: "claude",
  effort: null,
  kind: "builder",
  label: "Orchestrator",
  model: null,
  refusal: null,
  ...over,
})

describe("a template picker row", () => {
  test("a row a gate refuses is disabled with the API's reason in place of its detail", () => {
    const claude = row({
      id: "second-dispatcher-claude",
      kind: "dispatcher",
      label: "Second dispatcher on Claude",
      refusal: "Add a second Claude account in Settings > Accounts",
    })
    expect(templateRowView(claude, false)).toEqual({
      detail: "Claude",
      label: "Second dispatcher on Claude",
      reason: "Add a second Claude account in Settings > Accounts",
    })
  })

  test("a dispatcher template is disabled while the second dispatcher runs; an orchestrator is not", () => {
    const glm = row({ backend: "glm", id: "second-dispatcher-glm", kind: "dispatcher" })
    expect(templateRowView(glm, true).reason).toBe("The second dispatcher is running")
    expect(templateRowView(glm, false).reason).toBeNull()
    expect(templateRowView(row({}), true).reason).toBeNull()
  })

  test("its detail is its backend or model, then its effort", () => {
    expect(templateRowView(row({ backend: "glm" }), false).detail).toBe("GLM")
    expect(templateRowView(row({ effort: "high", model: "opus" }), false).detail).toBe(
      "opus · High",
    )
  })
})
