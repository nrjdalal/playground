// What a delete decision names by full path, so the owner approves the very path that goes.

// Pure: each word of a delete's what, stripped of the quotes and punctuation around it.
export const targetWords = (what: string): string[] =>
  what
    .split(/\s+/)
    .map((word) => word.replace(/^[`'"(]+|[`'",.;:)]+$/g, "").replace(/(.)\/$/, "$1"))
    .filter((word) => word !== "")
