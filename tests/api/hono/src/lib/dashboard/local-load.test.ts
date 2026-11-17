import { describe, expect, test } from "bun:test"

import {
  loadArgv,
  MODEL_FOLDER,
  START_MS,
  startModel,
} from "../../../../../../api/hono/src/lib/dashboard/local-load"

describe("loadArgv", () => {
  test("it runs the playground CLI's model use on the kept model's folder, by this bun and no shell", () => {
    expect(loadArgv("ornith-1.5-122b", "/repo", "/bin/bun")).toEqual([
      "/bin/bun",
      "/repo/packages/scripts/src/playground/cli.ts",
      "model",
      "use",
      "ornith-1.5-122b",
    ])
    expect(loadArgv("m", "/repo")[0]).toBe(process.execPath)
  })

  test("a name MODEL_FOLDER refuses throws before any argv is built", () => {
    for (const name of ["", "-rf", "../m", "M", "a b", "m;ls", "m/n", "m\nn"]) {
      expect(MODEL_FOLDER.test(name)).toBe(false)
      expect(() => loadArgv(name, "/repo")).toThrow("is not a model folder name")
    }
  })
})

describe("startModel", () => {
  test("a fixture stack, which a test run reads, starts no model and reaches no machine", async () => {
    expect(await startModel("m-folder", "/no/such/checkout")).toEqual({
      code: 0,
      line: "a fixture stack starts no model",
    })
    expect(START_MS).toBe(20 * 60_000)
  })
})
