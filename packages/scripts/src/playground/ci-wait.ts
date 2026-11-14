export const POLL_SECONDS = 300

export type CiWaitDeps = {
  err: (line: string) => void
  gh: (args: string[]) => { code: number; stderr: string; stdout: string }
  now: () => number
  out: (line: string) => void
  repo: () => Promise<string>
  sleep: (seconds: number) => Promise<void>
}

export async function runCiWait(_words: string[], _deps: CiWaitDeps): Promise<number> {
  return 99
}
