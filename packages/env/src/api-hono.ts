import { createEnv } from "@t3-oss/env-core"

import "@/load-dotenv"
import { apiHono } from "@/keys"
import { introducedEnvKeys, spawnEnvOf } from "@/spawn-env"

// The environment this process hands the programs it starts, its session starts among them: the one it started with, plus the PLAYGROUND_* and DESK_* names it read after it started
export const spawnEnv = (): Record<string, string> => spawnEnvOf(process.env, introducedEnvKeys)

export const env = createEnv({ ...apiHono, emptyStringAsUndefined: true })
