import "./aliases"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

type Env = Record<string, string | undefined>

// Claude Code's config folder: CLAUDE_CONFIG_DIR when set, else ~/.claude. It holds Claude's own state and the skills links, never the data folder.
export const configDirOf = (env: Env = process.env): string =>
  env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")

// The folder the dashboard and the factory keep their files in outside the database: PLAYGROUND_DATA_DIR when the env given names it, else .playground in the home folder. The env is required, `{}` for a folder that never follows PLAYGROUND_DATA_DIR, so no caller drops it by leaving it out.
export const dataDirOf = (env: Env, home = env.HOME || homedir()): string =>
  env.PLAYGROUND_DATA_DIR ? resolve(env.PLAYGROUND_DATA_DIR) : join(home, ".playground")

// The data folder the env names, PLAYGROUND_DATA_DIR included: the factory's scripts read it so, as the dashboard does on a stack that reads this machine.
export const dataDir = (env: Env = process.env): string => dataDirOf(env)
