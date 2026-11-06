import { describe, expect, test } from "bun:test"

import { RELAY_PREFIX, signedBytes } from "../../../../../packages/message/src/index"
import { signedFetch } from "../../../../../web/next/src/lib/relay-write"

const BASE = "https://api.yard.example"

// A browser key made for the test alone, its private half never exported, as the hosted web keeps one.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
  "sign",
  "verify",
])
const SIGNER = { id: "oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U", privateKey: pair.privateKey }

// A send that keeps each request it is handed and answers it as the hub would.
const hub = () => {
  const sent: Request[] = []
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Request(input, init))
    return Response.json({ data: { sent: true } }, { status: 201 })
  }) as typeof fetch
  return { send, sent }
}

const fetchFor = (send: typeof fetch, signer: typeof SIGNER | null = SIGNER) =>
  signedFetch({ base: BASE, login: async () => "fixture-owner", send, signer: async () => signer })

describe("a write from the hosted dashboard", () => {
  test("goes to the hub's write route as one frame this browser's key signed over its path, body and login", async () => {
    const { send, sent } = hub()
    const body = JSON.stringify({ text: "hello" })
    const answer = await fetchFor(send)(`${BASE}${RELAY_PREFIX}/api/v1/messages`, {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    expect(answer.status).toBe(201)
    expect(sent.map((one) => [one.method, one.url, one.credentials])).toEqual([
      ["POST", `${BASE}${RELAY_PREFIX}/write`, "include"],
    ])
    const frame = await sent[0]!.json()
    expect({ ...frame, at: "at", id: "id", sig: "sig" }).toEqual({
      at: "at",
      body,
      id: "id",
      keyId: SIGNER.id,
      login: "fixture-owner",
      method: "POST",
      path: "/api/v1/messages",
      sig: "sig",
      type: "write",
    })
    const verified = await crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      pair.publicKey,
      new Uint8Array(Buffer.from(frame.sig, "base64url")),
      await signedBytes(frame),
    )
    expect(verified).toBe(true)
  })

  test("keeps a write's query in the signed path, and gives each write its own id", async () => {
    const { send, sent } = hub()
    const write = fetchFor(send)
    for (let n = 0; n < 2; n++)
      await write(`${BASE}${RELAY_PREFIX}/api/v1/inbox/abc/answer?from=yard`, {
        body: "{}",
        method: "POST",
      })
    const frames = await Promise.all(sent.map((one) => one.json()))
    expect(frames.map((frame) => frame.path)).toEqual([
      "/api/v1/inbox/abc/answer?from=yard",
      "/api/v1/inbox/abc/answer?from=yard",
    ])
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(2)
  })

  test("a browser with no paired key sends nothing and says where to pair", async () => {
    const { send, sent } = hub()
    const answer = await fetchFor(send, null)(`${BASE}${RELAY_PREFIX}/api/v1/messages`, {
      body: "{}",
      method: "POST",
    })
    expect([answer.status, (await answer.json()).error.message, sent]).toEqual([
      403,
      "Pair this browser with your Mac in Settings, under Remote, to send from Yard",
      [],
    ])
  })

  test("a read goes as it was, unsigned", async () => {
    const { send, sent } = hub()
    await fetchFor(send)(`${BASE}${RELAY_PREFIX}/api/v1/inbox`, { credentials: "include" })
    expect(sent.map((one) => [one.method, one.url, one.headers.get("x-sig")])).toEqual([
      ["GET", `${BASE}${RELAY_PREFIX}/api/v1/inbox`, null],
    ])
  })
})
