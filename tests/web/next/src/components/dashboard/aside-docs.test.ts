import { describe, expect, test } from "bun:test"

import { pageQuery } from "../../../../../../web/next/src/components/dashboard/aside-docs"
import { MISSING } from "../../../../../../web/next/src/components/dashboard/viewer/use-attachment-url"

const URL_OF_PAGE = "https://api.test/api/v1/apps/previews/sidebar-mock.html"

// A fetch that answers with status and records each call's url and credentials.
const recorded = (status: number) => {
  const calls: { credentials?: RequestCredentials; url: string }[] = []
  const load = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ credentials: init?.credentials, url: String(url) })
    return new Response(status === 200 ? "<p>page</p>" : "", { status })
  }
  return { calls, load: load as typeof fetch }
}

describe("a kept page opened in an aside tab", () => {
  test("is fetched with the owner's cookie into a blob URL the HTML view reads", async () => {
    const { calls, load } = recorded(200)
    const url = await pageQuery(URL_OF_PAGE, load).queryFn()
    expect(calls).toEqual([{ credentials: "include", url: URL_OF_PAGE }])
    expect(url).toStartWith("blob:")
    expect(await (await fetch(url)).text()).toBe("<p>page</p>")
  })

  test("reads missing once Previews answers 404, and fails on any other error", async () => {
    expect(await pageQuery(URL_OF_PAGE, recorded(404).load).queryFn()).toBe(MISSING)
    await expect(pageQuery(URL_OF_PAGE, recorded(500).load).queryFn()).rejects.toThrow("(500)")
  })
})
