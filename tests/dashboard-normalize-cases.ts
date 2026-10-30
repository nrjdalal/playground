// What the dashboard types for a message, shared by the API's normalize test and the web outbox's comparable test: the outbox finds a sent message in the transcript by the text the API typed, so both must turn each input into the same output.
export const NORMALIZE_CASES: [input: string, typed: string][] = [
  ["  a\r\nb\rc\td\u0007e\u001b[31m\u007f\u0085\u009b  \n", "a\nb\nc    de[31m"],
  ["hi\tthere\r\nsecond  ", "hi    there\nsecond"],
  ["\n\nkeep\n\n inner \n", "keep\n\n inner"],
]
