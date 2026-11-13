// A check for the factory's sessions, run on Bash by guards.ts alone: refuses a git push that writes main or canary of the factory's repository. A stub until its fix lands.
type Environment = Record<string, string | undefined>

export async function check(
  _raw: string,
  _environment: Environment = process.env,
): Promise<string | undefined> {
  return undefined
}
