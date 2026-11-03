// Run by yard.test.ts as `bun -e` in api/hono: a GitHub sign-in through Better Auth's own routes, with GitHub's three endpoints answered here, then an update-user that tries to set the login; prints one JSON line of the statuses.
const real = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith("https://github.com/login/oauth/access_token"))
    return Response.json({
      access_token: "gh-token",
      scope: "read:user,user:email",
      token_type: "bearer",
    })
  if (url === "https://api.github.com/user")
    return Response.json({
      avatar_url: "",
      email: null,
      id: 4242,
      login: process.env.GH_LOGIN,
      name: "New Holder",
    })
  if (url === "https://api.github.com/user/emails")
    return Response.json([
      { email: ["new", "example.com"].join("@"), primary: true, verified: true },
    ])
  return real(input, init)
}) as typeof fetch

const { default: shape } = await import(process.env.YARD_HOSTED!)
const server = Bun.serve(shape)
const base = `http://127.0.0.1:${server.port}/api/auth`
const web = process.env.HONO_WEB_URL!
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")

const start = await fetch(`${base}/sign-in/social`, {
  body: JSON.stringify({ callbackURL: "/", provider: "github" }),
  headers: { "content-type": "application/json", origin: web },
  method: "POST",
})
const state = new URL((await start.json()).url).searchParams.get("state")
const callback = await fetch(`${base}/callback/github?code=gh-code&state=${state}`, {
  headers: { cookie: cookies(start) },
  redirect: "manual",
})
const update = await fetch(`${base}/update-user`, {
  body: JSON.stringify({ login: "spoofed" }),
  headers: { "content-type": "application/json", cookie: cookies(callback), origin: web },
  method: "POST",
})
console.log(JSON.stringify({ callback: callback.status, update: update.status }))
process.exit(0)

export {}
