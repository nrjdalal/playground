// The browser keys the dashboard wrote before the rename, each with the key that replaced it.
export const OLD_KEYS: Record<string, string> = {
  "desk.composer.drafts.v1": "dashboard.composer.drafts.v1",
  "desk.paste-log": "dashboard.paste-log",
  "desk.paste-log.loaded": "dashboard.paste-log.loaded",
  "lightman:aside:autoHide": "playground:aside:autoHide",
  "lightman:music:last": "playground:music:last",
  "lightman:music:liked": "playground:music:liked",
  "lightman:music:recent": "playground:music:recent",
  "lightman:music:volume": "playground:music:volume",
  "lightman:seen:inbox": "playground:seen:inbox",
}

// Moves each old key's value to its new key once, a value the new key already holds winning; a storage that refuses is left as it is.
export function moveOldKeys(storage: Pick<Storage, "getItem" | "removeItem" | "setItem">): void {
  try {
    for (const [old, key] of Object.entries(OLD_KEYS)) {
      const value = storage.getItem(old)
      if (value === null) continue
      if (storage.getItem(key) === null) storage.setItem(key, value)
      storage.removeItem(old)
    }
  } catch {}
}
