// The keys the .env files set that the environment did not hold, which the API's spawns keep off the children they start: dotenv hands a value ahead of the reader's own .env, which never overrides a set one, so a session started with this checkout's POSTGRES_URL would read this checkout's database from its own worktree. A stage file's keys all count, since its read overrides whatever held the name.
export const introducedEnvKeys = new Set<string>()

// The environment an API process hands the programs it starts: the one it started with, plus the PLAYGROUND_* and DESK_* names it read after it started, since a spawn.sh run from the Dashboard takes this environment and a spawn's own checkout reads its own .env
export const spawnEnvOf = (
  source: Record<string, string | undefined>,
  introduced: Set<string>,
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (introduced.has(key) && !/^(PLAYGROUND|DESK)_/.test(key)) continue
    env[key] = value
  }
  return env
}
