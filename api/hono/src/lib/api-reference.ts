import { site } from "@packages/config/site"
import { Scalar } from "@scalar/hono-api-reference"
import type { Context } from "hono"

// Scalar's single-file bundle, served from our own origin at the version the catalog installs, never from a CDN: the page runs on the web origin, where a third-party script could read every owner-rung route.
export const SCALAR_BUNDLE_PATH = "/api/docs/scalar.js"

// The build copies the bundle beside the API's code (dist/scalar.js, bundle/scalar.js), which is all a Docker image holds; running from source (tests), the installed package is the fallback. Resolved per request, so a missing file fails this route alone, never the API's start.
const scalarBundle = async () => {
  const beside = Bun.file(new URL("./scalar.js", import.meta.url))
  if (await beside.exists()) return beside
  return Bun.file(new URL("./browser/standalone.js", import.meta.resolve("@scalar/api-reference")))
}

// Streamed rather than buffered, with an ETag of the file's size and mtime, so a reload revalidates to a 304 instead of resending 4 MB.
export const serveScalarBundle = async (c: Context) => {
  const file = await scalarBundle()
  const etag = `"${file.size}-${file.lastModified}"`
  c.header("Cache-Control", "no-cache")
  c.header("ETag", etag)
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304)
  c.header("Content-Type", "text/javascript; charset=utf-8")
  c.header("X-Content-Type-Options", "nosniff")
  return c.body(file.stream())
}

// The Scalar API reference UI, gated by the apiDocs feature, with a nonce per request so its CSP admits only our bundle and Scalar's own inline start-up script.
export const apiReference = Scalar((c) => {
  const nonce = crypto.randomUUID()
  c.header(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  )
  // Scalar's hosted tools (Share uploads to api.scalar.com, Ask AI, MCP, Deploy, the Open API Client link to client.scalar.com) and its telemetry stay off: the reference documents a loopback dashboard, so nothing about it leaves this machine.
  return {
    agent: { disabled: true },
    cdn: SCALAR_BUNDLE_PATH,
    defaultOpenAllTags: true,
    expandAllResponses: true,
    hideClientButton: true,
    mcp: { disabled: true },
    nonce,
    pageTitle: `API Reference | ${site.name}`,
    showDeveloperTools: "never",
    telemetry: false,
    url: "/api/openapi.json",
    withDefaultFonts: false,
  }
})
