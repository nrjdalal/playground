import { describe, expect, test } from "bun:test"

import { dispatcherLabel, modelName, providerOf } from "../../../../../web/next/src/lib/model-label"

describe("modelName", () => {
  test("a model id as people say it, with its date and context suffix dropped, else the id as written", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5")
    expect(modelName("claude-sonnet-5-5")).toBe("Sonnet 5.5")
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5")
    expect(modelName("claude-fable-5-1")).toBe("Fable 5.1")
    expect(modelName("claude-opus-5-5[1m]")).toBe("Opus 5.5")
    expect(modelName("claude-opus-5")).toBe("Opus 5")
    expect(modelName("gpt-9")).toBe("gpt-9")
    expect(modelName("claude-mystery-1-0")).toBe("claude-mystery-1-0")
    expect(modelName(null)).toBeNull()
  })

  test("a GLM id reads as people say it, its 1M suffix dropped", () => {
    expect(modelName("glm-5.3-flash")).toBe("GLM 5.3 Flash")
    expect(modelName("glm-5.3-flash[1m]")).toBe("GLM 5.3 Flash")
    expect(modelName("glm-5.3")).toBe("GLM 5.3")
    expect(modelName("glm-9")).toBe("glm-9")
  })
})

// #i520: "two dispatcher rows, each named by the model it runs ... 'Opus 5.5 High' and 'GLM 5.3 Flash High'"
describe("dispatcherLabel", () => {
  test("its newest reply's model and effort, each word capitalised", () => {
    expect(dispatcherLabel({ effort: "high", model: "claude-opus-5-5" }, true)).toBe(
      "Opus 5.5 High",
    )
    expect(dispatcherLabel({ effort: "high", model: "glm-5.3-flash" }, false)).toBe(
      "GLM 5.3 Flash High",
    )
    expect(dispatcherLabel({ effort: null, model: "claude-opus-5-5" }, true)).toBe("Opus 5.5")
  })

  // The dispatcher slots show model names, never a worker's name.
  test("with no reply read yet, or its session down, its role in the slot alone, never a session's name", () => {
    expect(dispatcherLabel(null, true)).toBe("Alpha")
    expect(dispatcherLabel(null, false)).toBe("Bravo")
    expect(dispatcherLabel({ effort: "high", model: null }, false)).toBe("Bravo")
  })
})

describe("providerOf", () => {
  test("a Claude model is Anthropic's, a GLM model Z.ai's, and anything else has no provider", () => {
    expect(providerOf("claude-opus-5-5")).toBe("anthropic")
    expect(providerOf("claude-haiku-4-5-20251001")).toBe("anthropic")
    expect(providerOf("claude-opus-5-5[1m]")).toBe("anthropic")
    expect(providerOf("glm-5.3-flash")).toBe("zai")
    expect(providerOf("gpt-9")).toBeNull()
    expect(providerOf(null)).toBeNull()
  })
})
