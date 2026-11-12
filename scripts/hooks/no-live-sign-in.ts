import { fromFactory } from "./role"

export async function check(
  _raw: string,
  _environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  return undefined
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
