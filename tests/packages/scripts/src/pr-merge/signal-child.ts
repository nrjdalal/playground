// A pr:merge stopped mid-run, for merge-signal.test.ts: `lock <root> <pr>` takes the merge lock in root and waits inside it; `types <root>` runs the types gate with a stub git, its worktree under root, and waits inside its one step. Each prints "ready" once there.
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { takeLock, type Run } from "../../../../../packages/scripts/src/pr-merge/merge"
import { typesGate } from "../../../../../packages/scripts/src/pr-merge/types"

const [mode, root = "", pr = "0"] = process.argv.slice(2)
const ok = (stdout = "") => ({ code: 0, stderr: "", stdout })

const git: Run = async (args) => {
  if (args[0] === "merge-base") return { code: 1, stderr: "", stdout: "" }
  if (args.includes("--git-common-dir")) return ok(join(root, ".git"))
  if (args.includes("--show-toplevel")) return ok(root)
  if (args.includes("add")) mkdirSync(args.at(-2) ?? "", { recursive: true })
  return ok("c0ffee")
}

if (mode === "lock") {
  if ("holder" in (await takeLock(root, Number(pr)))) process.exit(2)
  console.log("ready")
} else {
  // the step spawns in the same tick as this line, so it runs by the time the test reads it
  void typesGate({
    facts: { canary: "canary", head: "head", mergeTree: "tree", n: 7 },
    git,
    lockRoot: join(root, "lock"),
    steps: () => {
      console.log("ready")
      return [{ argv: ["sleep", "5"], name: "wait" }]
    },
  })
}
setInterval(() => {}, 1000)
