import { relockRoot } from "@packages/settings"

import type { Context } from "./tick"

// Stub for the red commit; the next commit builds it.
export const extLock =
  (_relock: (data: string) => boolean = relockRoot) =>
  async (_ctx: Context) => {}
