// The composer's files not uploaded yet, kept in this browser's IndexedDB under the session's draft, so a dashboard restart, after which next dev reloads the page, loses none. A file leaves once it is uploaded, sent or removed; every access fails quietly to nothing, and the composer works as before.
export type KeptFile = { at: number; file: File; key: string; to: string }

const DB = "dashboard.composer"
// The store's name before the rename: a new store takes its files once, then it goes.
const OLD_DB = "desk.composer"
const STORE = "files"
// The dashboard keeps an uploaded file a week, so a file waiting here is kept no longer; that sweep also clears a file kept under a session's old name after a /rename.
export const KEEP_MS = 7 * 24 * 60 * 60_000

let opened: Promise<IDBDatabase | null> | null = null

// Copies the old store's files into a new one and deletes the old; no old store (opening it would create one, so that is aborted) or one that fails to read leaves nothing to copy.
const takeOld = (db: IDBDatabase): Promise<void> =>
  new Promise((resolve) => {
    const request = indexedDB.open(OLD_DB)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => resolve()
    request.onsuccess = () => {
      const old = request.result
      try {
        const read = old.transaction(STORE, "readonly").objectStore(STORE).getAll()
        read.onsuccess = () => {
          const store = db.transaction(STORE, "readwrite").objectStore(STORE)
          for (const row of read.result) store.put(row)
          old.close()
          indexedDB.deleteDatabase(OLD_DB)
          resolve()
        }
        read.onerror = () => {
          old.close()
          resolve()
        }
      } catch {
        old.close()
        resolve()
      }
    }
  })

const open = (): Promise<IDBDatabase | null> =>
  (opened ??= new Promise((resolve) => {
    try {
      let created = false
      const request = indexedDB.open(DB, 1)
      request.onupgradeneeded = () => {
        created = true
        request.result.createObjectStore(STORE, { keyPath: "key" })
      }
      request.onsuccess = () =>
        created
          ? takeOld(request.result).then(() => resolve(request.result))
          : resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  }))

const run = async <T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> => {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export const keepFile = async (kept: KeptFile): Promise<void> => {
  await run("readwrite", (store) => store.put(kept))
}

export const dropFile = async (key: string): Promise<void> => {
  await run("readwrite", (store) => store.delete(key))
}

// Whether a file is still kept: another tab that uploaded it has dropped it. A store that cannot be read says yes, so the upload goes ahead as it would with no store.
export const isKept = async (key: string): Promise<boolean> =>
  (await run("readonly", (store) => store.getKey(key))) !== undefined

// Pure: the stored rows that read whole, split into one session's, oldest first, and those past KEEP_MS, from any session, to drop.
export function sortKept(
  rows: unknown[],
  to: string,
  now: number,
): { kept: KeptFile[]; stale: string[] } {
  const whole = rows.filter((row): row is KeptFile => {
    const { at, file, key, to: owner } = (row ?? {}) as Record<string, unknown>
    return (
      typeof at === "number" &&
      file instanceof File &&
      typeof key === "string" &&
      typeof owner === "string"
    )
  })
  return {
    kept: whole
      .filter((row) => row.to === to && now - row.at < KEEP_MS)
      .sort((a, b) => a.at - b.at),
    stale: whole.filter((row) => now - row.at >= KEEP_MS).map((row) => row.key),
  }
}

// One session's kept files, dropping every session's that are past a week.
export async function keptFiles(to: string, now = Date.now()): Promise<KeptFile[]> {
  const { kept, stale } = sortKept(
    (await run("readonly", (store) => store.getAll())) ?? [],
    to,
    now,
  )
  for (const key of stale) void dropFile(key)
  return kept
}

// Runs one file's upload while this tab holds that file's lock, so two tabs a restart reloaded never upload it twice: a tab that finds the lock held leaves the file to the other and returns false. With no Web Locks it runs as is.
export async function withClaim(
  key: string,
  upload: () => Promise<void>,
  locks: Pick<LockManager, "request"> | null = globalThis.navigator?.locks ?? null,
): Promise<boolean> {
  let ran = false
  const once = async () => {
    ran = true
    await upload()
    return true
  }
  if (!locks) return once()
  try {
    return await locks.request(`dashboard.upload:${key}`, { ifAvailable: true }, (lock) =>
      lock ? once() : false,
    )
  } catch {
    return ran ? true : once()
  }
}
