import { createEnv } from "@t3-oss/env-core"

import "@/load-dotenv"
import { auth } from "@/keys"

export const env = createEnv({ ...auth, emptyStringAsUndefined: true })
