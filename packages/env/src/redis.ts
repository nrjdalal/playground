import { createEnv } from "@t3-oss/env-core"

import "@/load-dotenv"
import { redis } from "@/keys"

export const env = createEnv({ ...redis, emptyStringAsUndefined: true })
