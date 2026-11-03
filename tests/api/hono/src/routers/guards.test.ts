import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// The routers' auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the routers load.
process.env.BETTER_AUTH_SECRET ||= "guards-test-secret-not-for-use-anywhere"
const { guardWrites, requireTrustedOrigin } =
  await import("../../../../../api/hono/src/middlewares/dashboard")
const { env } = await import("../../../../../packages/env/dist/api-hono.mjs")

const ROUTERS = join(import.meta.dir, "../../../../../api/hono/src/routers")
const READS = new Set(["GET", "HEAD", "OPTIONS"])

type Route = { handler: unknown; method: string; path: string }
type Router = {
  request: (url: string, init?: RequestInit, env?: unknown) => Promise<Response>
  routes: Route[]
}
type Found = { file: string; name: string; owner: boolean; router: Router }

const isRouter = (value: unknown): value is Router =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Router).routes) &&
  typeof (value as Router).request === "function"

// Every router the API can mount, in any folder under routers/, and whether it sits on the dashboard's owner rung, read from its source so a router added later is walked too.
const found: Found[] = []
for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: ROUTERS })) {
  if (file === "index.ts") continue
  const source = await Bun.file(join(ROUTERS, file)).text()
  const owner = source.includes('requireConsoleRole("owner")')
  for (const [name, value] of Object.entries(await import(join(ROUTERS, file))))
    if (isRouter(value)) found.push({ file, name, owner, router: value })
}
const owners = found.filter((f) => f.owner)

// A guard's path covers every route: /*, or the dashboard router's /:segment{a|b}/* naming each route's first segment, so its mount at /api/v1 leaves user and admin alone.
const coversEvery = (path: string, router: Router): boolean => {
  if (path === "/*") return true
  const segments = /^\/:\w+\{([\w|-]+)\}\/\*$/.exec(path)?.[1]?.split("|")
  return (
    !!segments &&
    router.routes.every((r) => r.method === "ALL" || segments.includes(r.path.split("/")[1]!))
  )
}

// Past both guards the next step is auth, which refuses a request with no session; onboarding reads none before an owner exists and serves local stacks alone, so its gate answers 404 under the test's NODE_ENV, still before any handler.
const PAST_GUARDS: Record<string, number> = { "onboard.ts": 404 }

const writesOf = (router: Router) =>
  router.routes.filter((r) => r.method !== "ALL" && !READS.has(r.method))

// Validated, the setting is a list; with validation skipped, as in CI, it is the raw comma-separated string.
const trusted = (): string => {
  const origins: unknown = env.HONO_TRUSTED_ORIGINS
  return Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()
}

// Stands in for the Bun server hono/bun reads the peer from; with none, the peer is unknown.
const peer = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50000 }),
})

const send = (router: Router, route: Route, origin: string, server?: ReturnType<typeof peer>) =>
  router.request(
    `http://127.0.0.1${route.path.replace(/:\w+/g, "x").replace(/\/\*$/, "/x")}`,
    {
      body: "{}",
      headers: { "content-type": "application/json", origin },
      method: route.method,
    },
    server,
  )

describe("every write on the owner rung is guarded by its method, not its path", () => {
  test("the walk finds the dashboard's routers", () => {
    expect(owners.map((f) => f.file).toSorted()).toEqual(
      expect.arrayContaining(["apps.ts", "dashboard.ts", "inbox.ts", "sessions.ts"]),
    )
  })

  // A router put on the owner rung another way (a shared constant) would drop out of the source check, so the routers the API mounts at the dashboard's paths must be among those walked.
  test("every router the API mounts at a dashboard path is walked as owner-rung", async () => {
    const index = await Bun.file(join(ROUTERS, "..", "local.ts")).text()
    const mounted = [...index.matchAll(/\.route\(\s*"\/([\w/-]+)"\s*,\s*(\w+)\s*\)/g)].map(
      ([, at, name]) => ({ at: at!, name: name! }),
    )
    const ownerNames = owners.map((f) => f.name)
    for (const at of ["v1/apps", "v1/inbox", "v1/sessions"])
      expect(ownerNames).toContain(mounted.find((m) => m.at === at)?.name ?? "")
    // the dashboard's own router has no segment of its own: it mounts at v1 beside v1Router
    expect(mounted.filter((m) => m.at === "v1").some((m) => ownerNames.includes(m.name))).toBe(true)
  })

  // guardWrites passes GET, HEAD and OPTIONS, so a GET must never write. Every owner-rung router mounts it whatever routes it has, so its first write, or one registered with .all(), is guarded with no change here: the guard judges the method at run time.
  test("every router on the owner rung mounts guardWrites on every route, with nothing before it but the socket's origin check (a GET must never write)", () => {
    const unguarded: string[] = []
    for (const { file, router } of owners) {
      const guard = router.routes.findIndex(
        (r) => r.handler === guardWrites && r.method === "ALL" && coversEvery(r.path, router),
      )
      if (guard === -1) {
        unguarded.push(`${file}: no guardWrites on every path`)
        continue
      }
      for (const r of router.routes.slice(0, guard))
        if (r.handler !== requireTrustedOrigin)
          unguarded.push(`${file}: ${r.method} ${r.path} runs before guardWrites`)
    }
    expect(unguarded).toEqual([])
  })
})

describe("a write is refused before any session read or handler unless it comes from the dashboard's own page on this machine", () => {
  // A route's own middlewares (a limiter, a validator) are entries of their own, so each method and path is walked once.
  const cases = owners.flatMap(({ file, router }) =>
    [...new Map(writesOf(router).map((r) => [`${r.method} ${r.path}`, r])).values()].map(
      (route) => ({ file, label: `${file} ${route.method} ${route.path}`, route, router }),
    ),
  )

  test("there are writes to walk", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  test.each(cases.map((c) => [c.label, c] as const))("%s", async (_, { file, route, router }) => {
    const foreign = await send(router, route, "http://evil.localhost", peer("127.0.0.1"))
    expect(foreign.status).toBe(403)
    expect(await foreign.text()).toContain("Untrusted origin")

    const noOrigin = await send(router, route, "", peer("127.0.0.1"))
    expect(noOrigin.status).toBe(403)

    const remote = await send(router, route, trusted(), peer("192.168.1.20"))
    expect(remote.status).toBe(403)
    expect(await remote.text()).toContain("Writes are taken from this machine only")

    const unknownPeer = await send(router, route, trusted())
    expect(unknownPeer.status).toBe(403)

    // The guard's 403s above came before the next step (PAST_GUARDS), so before any session read, cmux call or handler.
    const next = PAST_GUARDS[file] ?? 401
    expect((await send(router, route, trusted(), peer("127.0.0.1"))).status).toBe(next)
    expect((await send(router, route, trusted(), peer("::1"))).status).toBe(next)
  })
})

describe("an ask's file is read only from the dashboard's own page on this machine (#2282)", () => {
  const inbox = found.find((f) => f.file === "inbox.ts")!.router
  const read = (origin: string, server?: ReturnType<typeof peer>) =>
    inbox.request(
      "http://127.0.0.1/attachments/3f0e7a52-1c4b-4d2a-9e6f-0000000000a1.png",
      { headers: origin ? { origin } : {} },
      server,
    )

  test("refused from another origin, with no origin (an <img> elsewhere), off loopback or from an unknown peer", async () => {
    expect((await read("http://evil.localhost", peer("127.0.0.1"))).status).toBe(403)
    expect((await read("", peer("127.0.0.1"))).status).toBe(403)
    expect((await read(trusted(), peer("192.168.1.20"))).status).toBe(403)
    expect((await read(trusted())).status).toBe(403)
  })

  test("past both guards it still needs the owner's session", async () => {
    expect((await read(trusted(), peer("127.0.0.1"))).status).toBe(401)
  })
})
