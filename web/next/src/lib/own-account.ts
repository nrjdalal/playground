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
