import { keyIdOf, type PairKey, pairKeySchema } from "@packages/message"

// This browser's key for writes from Yard: an ECDSA P-256 pair made with WebCrypto, its private half non-extractable, so it signs here and nowhere else, kept in IndexedDB with its public half, which pairing sends to the Mac.

type Stored = { privateKey: CryptoKey; publicKey: PairKey }

export type BrowserKey = { fingerprint: string; id: string; publicKey: PairKey }

const DB = "playground-remote"
const STORE = "keys"
const SLOT = "browser"

const request = <T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode) =>
  new Promise<T>((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const done = run(db.transaction(STORE, mode).objectStore(STORE))
      done.onsuccess = () => {
        db.close()
        resolve(done.result)
      }
      done.onerror = () => {
        db.close()
        reject(done.error)
      }
    }
  })

const named = async (stored: Stored): Promise<BrowserKey> => ({
  ...(await keyIdOf(stored.publicKey)),
  publicKey: stored.publicKey,
})

// The key this browser keeps, or null before one is made.
export async function readBrowserKey(): Promise<BrowserKey | null> {
  const stored = await request<Stored | undefined>((store) => store.get(SLOT), "readonly")
  return stored ? named(stored) : null
}

// Makes this browser's key, in place of any it kept, and keeps it.
export async function makeBrowserKey(): Promise<BrowserKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])
  const publicKey = pairKeySchema.parse(await crypto.subtle.exportKey("jwk", pair.publicKey))
  const stored: Stored = { privateKey: pair.privateKey, publicKey }
  await request((store) => store.put(stored, SLOT), "readwrite")
  return named(stored)
}
