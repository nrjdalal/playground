// Red-first stand-in: canary holds no guard for a prepare-only session's writes.
export async function check(
  _raw: string,
  _environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  return undefined
}
