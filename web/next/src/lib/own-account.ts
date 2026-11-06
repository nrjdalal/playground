import { withOwn } from "@packages/config/accounts"

// The switch's write: reads usage.accounts whole, marks the one row and writes the list back, refusing a value that is not a list so no write replaces it with an empty one; the page and its test pass the read and the write.
export const markOwn = async (
  key: string,
  own: boolean,
  io: { read: () => Promise<unknown>; write: (rows: Record<string, unknown>[]) => Promise<void> },
) => {
  const value = await io.read()
  if (!Array.isArray(value)) throw new Error("usage.accounts is not a list, so it is left as it is")
  await io.write(withOwn(value as Record<string, unknown>[], key, own))
}
