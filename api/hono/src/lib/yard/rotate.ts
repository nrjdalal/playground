type Item = { read: () => Promise<string | null>; write: (value: string) => Promise<void> }

export type RotateDeps = {
  client: (token: string) => {
    me: () => Promise<unknown>
    swapToken: (secret: string) => Promise<unknown>
  }
  keychain: Item
  pending: Item & { remove: () => Promise<void> }
  renew: () => void
}

export const rotate = async (_deps: RotateDeps): Promise<"kept" | "none" | "swapped"> => {
  throw new Error("not built yet")
}

export const startRotation = (
  _deps: RotateDeps & {
    alert: (text: string) => Promise<void>
    checkMs?: number
    now?: () => number
    stamp: string
  },
): (() => void) => {
  return () => {}
}

export const outboxAlert =
  (_dir: string, _now?: () => Date) =>
  async (_text: string): Promise<void> => {}
