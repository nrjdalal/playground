import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  attachmentQuery,
  MISSING,
  pageQuery,
} from "../../../../../../../web/next/src/components/dashboard/viewer/use-attachment-url"
import { makeQueryClient } from "../../../../../../../web/next/src/lib/query"

const web = join(import.meta.dir, "../../../../../../../web/next")
type Observer = { subscribe: (listener: () => void) => () => void }
const { QueryObserver } = (await import(Bun.resolveSync("@tanstack/react-query", web))) as {
  QueryObserver: new (client: unknown, options: unknown) => Observer
}

const ID = "3f0e7a52-1c4b-4d2a-9e6f-000000000001.png"

// A fetch that answers every call with status and counts the calls.
const counted = (status: number) => {
  const calls: string[] = []
  const load = async (url: string | URL | Request) => {
    calls.push(String(url))
    return new Response(status === 200 ? "png" : "", { status })
  }
  return { calls, load: load as typeof fetch }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

// Mounts one observer of the file's query, as a card's thumbnail, its slide or its open-in-tab square does, waits for it to settle, then unmounts it.
const mount = async (client: unknown, options: unknown) => {
  const off = new QueryObserver(client, options).subscribe(() => {})
  await settle()
  off()
}

describe("an attachment's fetch", () => {
  test("a 404 settles as missing at once, fetched once however often its card renders", async () => {
    const client = makeQueryClient()
    const { calls, load } = counted(404)
    const options = attachmentQuery(ID, true, load)
    for (let render = 0; render < 5; render++) await mount(client, options)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(`/inbox/attachments/${ID}`)
    expect(
      (client as { getQueryData: (key: unknown) => unknown }).getQueryData(options.queryKey),
    ).toBe(MISSING)
  })

  test("a file that arrives is fetched once too, as a blob URL", async () => {
    const client = makeQueryClient()
    const { calls, load } = counted(200)
    const options = attachmentQuery(ID, true, load)
    for (let render = 0; render < 3; render++) await mount(client, options)
    expect(calls).toHaveLength(1)
    const data = (client as { getQueryData: (key: unknown) => unknown }).getQueryData(
      options.queryKey,
    )
    expect(String(data)).toStartWith("blob:")
  })

  test("a slide far from the one shown fetches nothing", async () => {
    const { calls, load } = counted(404)
    await mount(makeQueryClient(), attachmentQuery(ID, false, load))
    expect(calls).toHaveLength(0)
  })
})

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
