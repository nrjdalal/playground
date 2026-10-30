import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"

import {
  IMAGE_PREVIEW_EXTENSIONS,
  isPreviewName,
} from "../../../../../api/hono/src/lib/apps/previews"
import { IMAGE_EXTENSIONS } from "../../../../../api/hono/src/lib/dashboard/attachments"
import {
  ownImageSrc,
  transcriptLink,
  transcriptUrls,
} from "../../../../../web/next/src/lib/markdown"

const API = "https://api.example.localhost"
const APP = "https://example.localhost"
const ORIGINS = [API, APP]
// A name the dashboard gives an image: a random UUID and an image extension.
const ID = "3ec1fab9-9dd4-4327-8bac-642ce1981bf9.png"

describe("ownImageSrc", () => {
  test("our own attachment loads, on either of our origins or as a path", () => {
    expect(ownImageSrc(`${API}/api/v1/attachments/${ID}`, ORIGINS)).toBe(
      `${API}/api/v1/attachments/${ID}`,
    )
    expect(ownImageSrc(`${APP}/api/v1/attachments/${ID}`, ORIGINS)).toBe(
      `${APP}/api/v1/attachments/${ID}`,
    )
    expect(ownImageSrc(`/api/v1/attachments/${ID}`, ORIGINS)).toBe(
      `${API}/api/v1/attachments/${ID}`,
    )
  })

  test("an image a transcript names by its path from before /api/v1 still loads, as the API still serves it", () => {
    expect(ownImageSrc(`/api/desk/attachments/${ID}`, ORIGINS)).toBe(
      `${API}/api/desk/attachments/${ID}`,
    )
    expect(ownImageSrc("/api/apps/previews/a.png", ORIGINS)).toBe(`${API}/api/apps/previews/a.png`)
  })

  test("any other image does not", () => {
    for (const src of [
      "https://evil.example/x.png",
      `//evil.example/api/v1/attachments/${ID}`,
      `https://evil.example/api/v1/attachments/${ID}`,
      `${API}/api/v1/attachments/${ID}?leak=1`,
      `${API}/api/v1/attachments/${ID}#x`,
      `${API}/api/v1/attachments/../../health`,
      `${API}/api/v1/attachments/a%2F..%2Fb`,
      `${API}/api/v1/attachments/`,
      `${API}/api/v1/attachments/abc`,
      `${API}/api/v1/attachments/3ec1fab9-9dd4-4327-8bac-642ce1981bf9.pdf`,
      `${API}/api/v1/attachments/3ec1fab9-9dd4-4327-8bac-642ce1981bf9.png.svg`,
      `${API}/api/v1/attachments/3EC1FAB9-9DD4-4327-8BAC-642CE1981BF9.png`,
      `${API}/api/asks`,
      `https://user:pw@api.example.localhost/api/v1/attachments/${ID}`,
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "not a url at all ::",
    ]) {
      expect(ownImageSrc(src, ORIGINS)).toBeNull()
    }
  })

  // The path is a copy of the API's naming, which the web cannot import: an image extension the API adds must load here too.
  test("every image name the API gives loads", () => {
    for (const extension of IMAGE_EXTENSIONS) {
      const src = `${API}/api/v1/attachments/${randomUUID()}.${extension}`
      expect(ownImageSrc(src, ORIGINS)).toBe(src)
    }
  })

  test("a preview image loads, on either of our origins or as a path", () => {
    for (const name of ["spinner-light-1.png", "a.gif", "System_item.2.webp"]) {
      expect(ownImageSrc(`/api/v1/apps/previews/${name}`, ORIGINS)).toBe(
        `${API}/api/v1/apps/previews/${name}`,
      )
      expect(ownImageSrc(`${APP}/api/v1/apps/previews/${name}`, ORIGINS)).toBe(
        `${APP}/api/v1/apps/previews/${name}`,
      )
    }
  })

  test("a preview page, or a name the Previews app would not serve, does not load as an image", () => {
    for (const src of [
      `${API}/api/v1/apps/previews/spinner-preview.html`,
      `${API}/api/v1/apps/previews/a.svg`,
      `${API}/api/v1/apps/previews/a..b.png`,
      `${API}/api/v1/apps/previews/.hidden.png`,
      `${API}/api/v1/apps/previews/a%2F..%2Fb.png`,
      `${API}/api/v1/apps/previews/a.png?x=1`,
      `${API}/api/v1/apps/previews/`,
      `${API}/api/v1/apps/previews`,
      `https://evil.example/api/v1/apps/previews/a.png`,
    ]) {
      expect(ownImageSrc(src, ORIGINS)).toBeNull()
    }
  })

  // The preview path is a copy of the API's name check, which the web cannot import: every image name the API serves loads, and none it refuses does.
  test("a preview image loads exactly when the API would serve its name", () => {
    for (const extension of IMAGE_PREVIEW_EXTENSIONS) {
      for (const name of [
        `a.${extension}`,
        `x-1_2.${extension}`,
        `a..b.${extension}`,
        `-a.${extension}`,
      ]) {
        const loads = ownImageSrc(`${API}/api/v1/apps/previews/${name}`, ORIGINS) !== null
        expect(loads).toBe(isPreviewName(name))
      }
    }
  })

  test("with no origin nothing loads", () => {
    expect(ownImageSrc(`/api/v1/attachments/${ID}`, [])).toBeNull()
  })
})

// The owner trusts these links, so no confirm pop-up: a link opens at once, so its href is the one check left.
describe("transcriptLink", () => {
  test("http and https open, another site's in a new tab", () => {
    expect(transcriptLink("https://github.com/acme/archive/pull/1", APP)).toEqual({
      external: true,
      href: "https://github.com/acme/archive/pull/1",
    })
    expect(transcriptLink("http://example.com/a?b=1#c", APP)).toEqual({
      external: true,
      href: "http://example.com/a?b=1#c",
    })
  })

  test("a path of our own opens on the app's origin, in the same tab", () => {
    expect(transcriptLink("/dashboard?worker=abc", APP)).toEqual({
      external: false,
      href: `${APP}/dashboard?worker=abc`,
    })
    expect(transcriptLink(`${APP}/dashboard/sessions`, APP)?.external).toBe(false)
  })

  // A footnote or a link to a heading stays on the page it is on, rather than resolving to the app's root.
  test("a fragment stays as it is, in this tab", () => {
    expect(transcriptLink("#x", APP)).toEqual({ external: false, href: "#x" })
    expect(transcriptLink("#user-content-fn-1", APP)).toEqual({
      external: false,
      href: "#user-content-fn-1",
    })
  })

  // A browser reads each of these as another host, so none passes as our own path.
  test("a protocol-relative or backslashed path is another site", () => {
    for (const href of [
      "//evil.example/x",
      "/\\evil.example/x",
      "\\\\evil.example/x",
      "/\t/evil.example/x",
    ]) {
      const link = transcriptLink(href, APP)
      expect(link?.external).toBe(true)
      expect(new URL(link!.href).host).toBe("evil.example")
    }
  })

  test("every other scheme, and credentials in the URL, are refused", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "mailto:someone@example.com",
      "vbscript:msgbox(1)",
      "blob:https://example.com/0f0e",
      "ftp://example.com/x",
      "slack://open",
      "https://user:pw@example.com/",
      "http://[not a url",
    ]) {
      expect(transcriptLink(href, APP)).toBeNull()
    }
  })
})

describe("transcriptUrls", () => {
  const transform = transcriptUrls(ORIGINS, APP)
  const node = (tagName: string) => ({
    children: [],
    properties: {},
    tagName,
    type: "element" as const,
  })

  test("an image or a source keeps only our own attachment", () => {
    expect(transform("https://evil.example/x.png", "src", node("img"))).toBeNull()
    expect(transform("https://evil.example/x.png", "src", node("source"))).toBeNull()
    expect(transform(`${API}/api/v1/attachments/${ID}`, "src", node("img"))).toBe(
      `${API}/api/v1/attachments/${ID}`,
    )
  })

  test("a link keeps an http or https href and drops any other", () => {
    expect(transform("https://example.com/docs", "href", node("a"))).toBe(
      "https://example.com/docs",
    )
    expect(transform("/dashboard", "href", node("a"))).toBe(`${APP}/dashboard`)
    for (const href of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"]) {
      expect(transform(href, "href", node("a"))).toBeNull()
    }
  })
})
