import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// SLOW_CHILD=<seconds> puts a `name` in `dir` (else a fresh scratch folder) that waits that long and then runs the real one, as a loaded runner starts a process late; returns its path, or `name` itself while SLOW_CHILD is unset
export const slowChild = (name: string, dir?: string) => {
  const delay = Number(process.env.SLOW_CHILD)
  const real = Bun.which(name)
  if (!delay || !real) return name
  const path = join(dir ?? mkdtempSync(join(tmpdir(), "slow-child-")), name)
  writeFileSync(path, `#!/bin/bash\nsleep ${delay}\nexec "${real}" "$@"\n`, { mode: 0o755 })
  return path
}
