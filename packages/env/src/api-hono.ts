import { createEnv } from "@t3-oss/env-core"

import "@/load-dotenv"
import { apiHono } from "@/keys"

export const env = createEnv({ ...apiHono, emptyStringAsUndefined: true })
