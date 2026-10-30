import { chmodSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// each try's limit: long enough for a fake bun under load, where 1s timed a fake's answer out, and short enough for a hang
export const TRY_MS = "4000"

// bun audit --json's answer for each [package, GHSA id, severity]
export const lockOf = (...rows: [string, string, string][]) => {
  const found: Record<string, { id: number; severity: string; title: string; url: string }[]> = {}
  for (const [pkg, id, severity] of rows)
    (found[pkg] ??= []).push({
      id: 1,
      severity,
      title: `${pkg} is unsafe`,
      url: `https://github.com/advisories/${id}`,
    })
  return JSON.stringify(found)
}

// a fake `bun` whose `audit --json` prints its folder's bun.lock as the answer, so each lockfile here is the advisories it carries; FAKE_503 answers each folder's first try with a 503
export const fakeBun = (dir: string) => {
  writeFileSync(
    join(dir, "bun"),
    `#!/bin/sh
echo "$PWD $*" >> "${dir}/tries"
if [ -n "$FAKE_503" ] && [ ! -f .tried ]; then : > .tried; echo "error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - 503" >&2; exit 1; fi
cat bun.lock
grep -q GHSA bun.lock && exit 1
exit 0
`,
  )
  chmodSync(join(dir, "bun"), 0o755)
  // a new executable's first run waits about 0.5s alone and past 3s beside the suite, so the fake takes that run here, outside every try's limit
  Bun.spawnSync([join(dir, "bun")], { cwd: dir, env: { PATH: "/usr/bin:/bin" } })
  rmSync(join(dir, "tries"))
}
