import { createEnv } from "@t3-oss/env-core"

import "@/load-dotenv"
import { db } from "@/keys"

export const env = createEnv({ ...db, emptyStringAsUndefined: true })
