import { describe, expect, test } from "bun:test"

import { localPagesOnly } from "../../../../../web/next/src/lib/local-pages"

const layout = "web/next/src/app/(protected)/layout.tsx"

describe("the dashboard's local pages on the hosted build", () => {
  test("a hosted build answers them with the app's 404", () => {
    let thrown: unknown
    try {
      localPagesOnly(true)
    } catch (error) {
      thrown = error
    }
    expect((thrown as { digest?: string })?.digest).toStartWith("NEXT_HTTP_ERROR_FALLBACK;404")
  })

  test("a local stack serves them", () => {
    expect(() => localPagesOnly(false)).not.toThrow()
  })

  test("their layout refuses before it reads anything", async () => {
    const source = await Bun.file(layout).text()
    const body = source.slice(source.indexOf("export default async function Layout"))
    expect(body.split("\n")[1]?.trim()).toBe("localPagesOnly(config.hosted)")
  })
})
