// Pure: usage.accounts with own set on the Claude row whose email is key, or dropped from it when switched off, every other row as it was; the value Settings' Own account switch writes. It imports nothing, so a script's test reads it outside the web's @/ paths.
export const withOwn = (
  rows: Record<string, unknown>[],
  key: string,
  own: boolean,
): Record<string, unknown>[] =>
  rows.map((row) => {
    if ((row.provider ?? "claude") !== "claude" || row.email !== key) return row
    const { own: _, ...rest } = row
    return own ? { ...rest, own: true } : rest
  })

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
