import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { machineRoots, sessionName } from "../trash"
import { diffSkills, download, manifestFor, parseManifest, vendored, vendor } from "./stage"

const USAGE = `Usage: bun run vendor:upstream [<sha or ref>]

Vendors the upstream skills core keeps from the repo upstream/SOURCE names, byte
for byte,
into extensions/core/skills/ at the ref's head (default main): downloads that
sha's tarball, stages the kept skills and LICENSE in core, checks every staged
byte against MANIFEST, swaps each skill folder and upstream/ in, and prints the
skills added and removed since the old MANIFEST. It never commits.`

const ROOT = join(import.meta.dir, "..", "..", "..", "..")
const CORE = join(ROOT, "extensions", "core")
// The upstream repo, the first word of SOURCE, so its name lives with upstream's own files.
const REPO = readFileSync(join(CORE, "upstream", "SOURCE"), "utf8").split(" ")[0]!

const gh = (...args: string[]): Buffer => {
  const run = Bun.spawnSync(["gh", "api", ...args], { stderr: "pipe", stdout: "pipe" })
  if (run.exitCode !== 0) {
    console.error(
      `vendor:upstream: gh api ${args.join(" ")} failed: ${run.stderr.toString().trim()}`,
    )
    process.exit(1)
  }
  return run.stdout
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { help: { short: "h", type: "boolean" } },
})
if (values.help) {
  console.log(USAGE)
  process.exit(0)
}
const ref = positionals[0] ?? "main"

const sha = gh(`repos/${REPO}/commits/${ref}`, "--jq", ".sha").toString().trim()
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`vendor:upstream: ${ref} resolved to ${sha}, which is not a sha`)
  process.exit(1)
}

const { kept, missing } = await download(gh, REPO, sha)
if (missing.length > 0) {
  console.error(`vendor:upstream: the tarball of ${sha} is missing ${missing.join(", ")}`)
  process.exit(1)
}
const files = vendored(kept)

const manifest = manifestFor(files)
const oldManifest = join(CORE, "upstream", "MANIFEST")
const oldText = existsSync(oldManifest) ? readFileSync(oldManifest, "utf8") : null
const done = vendor({
  coreDir: CORE,
  files,
  manifest,
  repo: REPO,
  roots: machineRoots(),
  session: await sessionName(),
  sha,
})
if (!done.ok) {
  console.error(`vendor:upstream: the staged bytes do not match MANIFEST, leaving core as it was:
${done.mismatches.join("\n")}`)
  process.exit(1)
}
console.log(`vendored ${REPO} at ${sha}: ${done.files} files`)
for (const line of diffSkills(oldText, parseManifest(manifest))) console.log(line)
