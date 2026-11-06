// Pure: usage.accounts with own set on the Claude row whose email is key, or dropped from it when cleared, every other row as it was; what Settings' Own account switch and the Inbox's own card write.
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
