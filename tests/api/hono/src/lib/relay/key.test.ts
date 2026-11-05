import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves here. Set before the modules load.
process.env.BETTER_AUTH_SECRET ||= "relay-key-test-secret-not-for-use-anywhere"
const { KEY_FILE, keyStore, PAIR_WAIT_MS } =
  await import("../../../../../../api/hono/src/lib/relay/key")
const { requireSignedWrite } = await import("../../../../../../api/hono/src/lib/relay/mac")
const { pairKeySchema, signedBytes } = await import("../../../../../../packages/message/src/index")

const scratch = mkdtempSync(join(tmpdir(), "relay-key-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const NOW = new Date("2026-11-05T01:00:00.000Z")

// A store in its own folder of scratch, its clock at at.
const store = () => {
  const dir = mkdtempSync(join(scratch, "data-"))
  const clock = { at: NOW }
  return { clock, dir, keys: keyStore({ dir: () => dir, now: () => clock.at }) }
}

// A browser's key made for the test alone, its private half never exported, and a pair frame that offers it.
const browserKey = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])
  const key = pairKeySchema.parse(await crypto.subtle.exportKey("jwk", pair.publicKey))
  const frame = {
    at: NOW.toISOString(),
    id: crypto.randomUUID(),
    key,
    login: "owner",
    type: "pair" as const,
  }
  return { frame, privateKey: pair.privateKey }
}

// Whether the store's paired key takes a write signed by signer under keyId, as the relay would check it.
const takes = async (keys: ReturnType<typeof keyStore>, signer: CryptoKey, keyId: string) => {
  const write = {
    at: NOW.toISOString(),
    body: "{}",
    id: crypto.randomUUID(),
    keyId,
    login: "owner",
    method: "POST",
    path: "/api/v1/messages",
    type: "write",
  }
  const sig = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    signer,
    await signedBytes(write),
  )
  const checked = await requireSignedWrite(
    JSON.stringify({ ...write, sig: Buffer.from(sig).toString("base64url") }),
    {
      key: await keys.paired(),
      login: "owner",
      now: NOW,
      seen: new Map(),
      writes: ["/api/v1/messages"],
    },
  )
  return checked !== null && "write" in checked
}

describe("the paired key, on this Mac", () => {
  test("a pair request reaches the list only through Approve", async () => {
    const { keys } = store()
    const browser = await browserKey()
    const offered = await keys.offer(browser.frame)
    expect([await keys.paired(), keys.pending()?.id]).toEqual([null, browser.frame.id])
    const paired = await keys.approve(browser.frame.id)
    expect([await keys.paired(), keys.pending()]).toEqual([paired, null])
    expect(paired && [paired.fingerprint, paired.login]).toEqual([offered.fingerprint, "owner"])
  })

  test("keeps the key in the data folder at mode 600", async () => {
    const { dir, keys } = store()
    const browser = await browserKey()
    await keys.offer(browser.frame)
    await keys.approve(browser.frame.id)
    expect(statSync(join(dir, KEY_FILE)).mode & 0o777).toBe(0o600)
  })

  test("pairs nothing for an id no request holds, or a request past its wait", async () => {
    const { clock, keys } = store()
    const browser = await browserKey()
    await keys.offer(browser.frame)
    expect(await keys.approve(crypto.randomUUID())).toBeNull()
    clock.at = new Date(NOW.getTime() + PAIR_WAIT_MS)
    expect([keys.pending(), await keys.approve(browser.frame.id), await keys.paired()]).toEqual([
      null,
      null,
      null,
    ])
  })

  test("refuses the old key right after a re-pair, and takes the new one", async () => {
    const { keys } = store()
    const first = await browserKey()
    await keys.offer(first.frame)
    const old = await keys.approve(first.frame.id)
    expect(await takes(keys, first.privateKey, old!.id)).toBe(true)
    const second = await browserKey()
    await keys.offer(second.frame)
    const next = await keys.approve(second.frame.id)
    expect([
      await takes(keys, first.privateKey, old!.id),
      await takes(keys, second.privateKey, next!.id),
    ]).toEqual([false, true])
  })

  test("refuses the key right after a revoke, which drops a waiting request too", async () => {
    const { keys } = store()
    const browser = await browserKey()
    await keys.offer(browser.frame)
    const paired = await keys.approve(browser.frame.id)
    const waiting = await browserKey()
    await keys.offer(waiting.frame)
    await keys.revoke()
    expect([
      await takes(keys, browser.privateKey, paired!.id),
      await keys.paired(),
      keys.pending(),
    ]).toEqual([false, null, null])
  })
})
