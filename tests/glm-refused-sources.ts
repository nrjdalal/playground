// A glm-refused-sources list for the tests: made-up and generic words, since an org's own words live in its list in the extensions, never in the checkout, whose copy is empty.
export const SOURCES = ["acme-db", "linear", "notion", "slack"]

// The first word of a list a text names, case-insensitively, as spawn.sh finds one in a brief.
export const sourceIn = (text: string, words: string[] = SOURCES): string | undefined => {
  const lower = text.toLowerCase()
  return words.find((word) => word && lower.includes(word.toLowerCase()))
}
