import { createEnv } from "@t3-oss/env-core"

import { webNext } from "@/keys"

export const env = createEnv({
  ...webNext,
  clientPrefix: "NEXT_PUBLIC_",
  emptyStringAsUndefined: true,
})
