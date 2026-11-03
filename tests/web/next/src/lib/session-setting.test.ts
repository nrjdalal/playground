import { describe, expect, test } from "bun:test"

import {
  EFFORT_LABELS,
  heldPick,
  isEffort,
  isModel,
  MODEL_LABELS,
  modelAlias,
  reportedSetting,
  shownValue,
} from "../../../../../web/next/src/lib/session-setting"

describe("the composer's model and effort picker", () => {
  test("lists the models by their family's word and the efforts least to most", () => {
    expect(MODEL_LABELS).toEqual({ fable: "Fable", haiku: "Haiku", opus: "Opus", sonnet: "Sonnet" })
    expect(Object.keys(EFFORT_LABELS)).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect([
      isModel("opus"),
      isModel("claude-opus-5-5"),
      isEffort("max"),
      isEffort("ultra"),
    ]).toEqual([true, false, true, false])
  })

  test("reads a model id as the alias it runs as, and another provider's as none", () => {
    expect(modelAlias("claude-opus-5-5")).toBe("opus")
    expect(modelAlias("claude-haiku-4-5-20251001")).toBe("haiku")
    expect(modelAlias("claude-fable-5-1[1m]")).toBe("fable")
    expect(modelAlias("glm-5.3-flash")).toBeNull()
    expect(modelAlias(null)).toBeNull()
    expect(reportedSetting({ effort: "xhigh", model: "claude-sonnet-5-5" })).toEqual({
      effort: "xhigh",
      model: "sonnet",
    })
    expect(reportedSetting({ effort: "auto", model: null })).toEqual({ effort: null, model: null })
  })

  test("shows a pick until the row reports a value other than the one it was picked over", () => {
    expect(shownValue({ from: "opus", to: "sonnet" }, "opus")).toBe("sonnet")
    expect(shownValue({ from: "opus", to: "sonnet" }, "sonnet")).toBe("sonnet")
    expect(shownValue({ from: "opus", to: "sonnet" }, "haiku")).toBe("haiku")
    expect(shownValue({ from: null, to: "high" }, null)).toBe("high")
    expect(shownValue(null, "low")).toBe("low")
  })

  test("a pick the dispatcher holds (QUEUED) stays shown, while any other refusal fails it", () => {
    expect(heldPick({ code: "CONFLICT", delivery: "QUEUED", message: "holds it" })).toBe(true)
    expect(heldPick({ code: "CONFLICT", delivery: "ON_PICKER", message: "on a card" })).toBe(false)
    expect(heldPick({ code: "CONFLICT", delivery: "INTERRUPTED", message: "typed" })).toBe(false)
    expect(heldPick({ code: "NETWORK_ERROR", message: "Network request failed" })).toBe(false)
    expect(heldPick(null)).toBe(false)
  })
})
