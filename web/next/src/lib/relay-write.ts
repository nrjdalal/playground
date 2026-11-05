import { base64url, RELAY_PREFIX, signedBytes } from "@packages/message"

// On the hosted build, the dashboard's writes go to the owner's Mac as frames this browser's paired key signs: the hub carries each to the Mac, which runs it only once the signature checks out there.

export type Signer = { id: string; privateKey: CryptoKey }

const READS = new Set(["GET", "HEAD", "OPTIONS"])

const refuse = (message: string) =>
  Response.json({ error: { code: "FORBIDDEN", message } }, { status: 403 })

// A fetch for the hosted dashboard's client: a read goes as it was; a POST is signed over its path below the relay's prefix, its body and the owner's login, and sent to the hub's write route as one frame; any other write, or one from a browser with no key, is refused here and sends nothing.
export function signedFetch({
  base,
  login,
  send = fetch,
  signer,
}: {
  base: string
  login: () => Promise<string>
  send?: typeof fetch
  signer: () => Promise<Signer | null>
}): typeof fetch {
  const relay = `${base}${RELAY_PREFIX}`
  const prefix = new URL(relay).pathname
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (READS.has(request.method)) return send(request)
    if (request.method !== "POST") return refuse("Send it on the Mac")
    const key = await signer()
    if (!key)
      return refuse("Pair this browser with your Mac in Settings, under Remote, to send from Yard")
    const url = new URL(request.url)
    const below = url.pathname.startsWith(`${prefix}/`)
      ? url.pathname.slice(prefix.length)
      : url.pathname
    const frame = {
      at: new Date().toISOString(),
      body: await request.text(),
      id: crypto.randomUUID(),
      keyId: key.id,
      login: await login(),
      method: "POST",
      path: `${below}${url.search}`,
    }
    const sig = await crypto.subtle.sign(
      { hash: "SHA-256", name: "ECDSA" },
      key.privateKey,
      await signedBytes(frame),
    )
    return send(`${relay}/write`, {
      body: JSON.stringify({ ...frame, sig: base64url(sig), type: "write" }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  }) as typeof fetch
}
