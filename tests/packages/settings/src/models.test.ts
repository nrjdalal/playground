import { expect, test } from "bun:test"

import { checkSetting, modelSettings, settingsFor } from "../../../../packages/settings/src"

test("each model key defaults to the model a session runs on today", () => {
  const unset = settingsFor([], "me")
  expect(modelSettings.get(unset, "models.claude")).toEqual([
    "claude-opus-5-5",
    "claude-fable-5-1",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
  ])
  expect(modelSettings.get(unset, "models.default")).toBe("claude-opus-5-5")
  expect(modelSettings.get(unset, "models.checker")).toBe("claude-opus-5-5")
  expect(modelSettings.get(unset, "models.glm")).toBe("glm-5.3-flash")
  expect(modelSettings.get(unset, "models.glmKeychainService")).toBe("playground-glm")
})

test("adding a model is one write of models.claude, and a list or id it cannot run is refused", () => {
  const added = ["claude-opus-5-5", "claude-opus-6"]
  expect(checkSetting("models.claude", added)).toEqual({
    key: "models.claude",
    ok: true,
    value: added,
  })
  expect(checkSetting("models.claude", []).ok).toBe(false)
  expect(checkSetting("models.default", "Opus 5.5").ok).toBe(false)
  expect(checkSetting("models.glm", "glm-5.3-flash[1m]").ok).toBe(false)
  expect(checkSetting("models.glmKeychainService", "glm' -w x").ok).toBe(false)
})
