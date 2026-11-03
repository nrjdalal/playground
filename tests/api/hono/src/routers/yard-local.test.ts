import { describe, expect, test } from "bun:test"

const { generateSpecs } = await import("../../../../../api/hono/node_modules/hono-openapi")
const { localYardRouter } = await import("../../../../../api/hono/src/routers/yard-local")

describe("the local Yard router's API reference", () => {
  test("documents a post as the 201 it answers, and every read as 200", async () => {
    const spec = await generateSpecs(localYardRouter)
    const statuses = (path: string, method: "get" | "post") =>
      Object.keys(spec.paths?.[path]?.[method]?.responses ?? {}).filter((code) =>
        code.startsWith("2"),
      )
    expect(statuses("/channels/{id}/messages", "post")).toEqual(["201"])
    expect(statuses("/channels/{id}/messages", "get")).toEqual(["200"])
    expect(statuses("/channels", "get")).toEqual(["200"])
    expect(statuses("/channels/{id}/read", "post")).toEqual(["200"])
  })
})
