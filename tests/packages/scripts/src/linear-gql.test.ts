import { describe, expect, test } from "bun:test"

import { linearGql } from "../../../../packages/scripts/src/linear-gql"

const KEY = "lin_api_made_up_key"

const answering = (status: number, body: unknown) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch

describe("linearGql", () => {
  test("sends the key in the Authorization header alone and returns the answer's data", async () => {
    let seen: RequestInit | undefined
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen = init
      return Response.json({ data: { viewer: { name: "Made Up" } } })
    }) as unknown as typeof fetch
    expect(await linearGql(KEY, fetchImpl)("{ viewer { name } }")).toEqual({
      viewer: { name: "Made Up" },
    })
    expect((seen?.headers as Record<string, string>).Authorization).toBe(KEY)
    expect(String(seen?.body)).not.toContain(KEY)
  })

  test("a refusal names Linear's status and first error, with the key masked", async () => {
    const call = linearGql(
      KEY,
      answering(401, { errors: [{ message: `Authentication required, ${KEY} not valid` }] }),
    )
    const error = await call("{ viewer { name } }").catch((e: Error) => e.message)
    expect(error).toStartWith("Linear 401: Authentication required")
    expect(error).not.toContain(KEY)
  })

  test("masks the key in an error from outside Linear's answer too, and refuses with no key", async () => {
    const throwing = (async () => {
      throw new TypeError(`fetch failed for key ${KEY}`)
    }) as unknown as typeof fetch
    expect(await linearGql(KEY, throwing)("{}").catch((e: Error) => e.message)).toBe(
      "fetch failed for key ***",
    )
    expect(await linearGql("", throwing)("{}").catch((e: Error) => e.message)).toBe(
      "LINEAR_API_KEY is not set",
    )
  })
})
