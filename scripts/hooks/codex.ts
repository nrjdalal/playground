// The reader of a Codex session's hook input, as the red rows find it: every input reaches a guard as it came.
export const guardInputs = (raw: string): string[] | null => [raw]

export async function eachInput(
  raw: string,
  _guard: string,
  judge: (input: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  return judge(raw)
}
