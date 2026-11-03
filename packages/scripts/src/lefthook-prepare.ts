// The install's prepare: runs `lefthook install` only when a hook lefthook.yml names is missing from the shared hooks folder or calls no lefthook, or check-install (which reads the config's checksum alone) fails, since Claude Code's sandbox refuses writes to .git/hooks.
const GIT_HOOKS = new Set([
  "applypatch-msg",
  "commit-msg",
  "fsmonitor-watchman",
  "post-applypatch",
  "post-checkout",
  "post-commit",
  "post-index-change",
  "post-merge",
  "post-receive",
  "post-rewrite",
  "post-update",
  "pre-applypatch",
  "pre-auto-gc",
  "pre-commit",
  "pre-merge-commit",
  "pre-push",
  "pre-rebase",
  "pre-receive",
  "prepare-commit-msg",
  "proc-receive",
  "push-to-checkout",
  "reference-transaction",
  "sendemail-validate",
  "update",
])

const run = (args: string[]) =>
  Bun.spawnSync(args, { stderr: "pipe", stdin: "ignore", stdout: "pipe" })

const hooksMatch = async () => {
  const config = Bun.file("lefthook.yml")
  if (!(await config.exists())) return false
  const hooks = run(["git", "rev-parse", "--path-format=absolute", "--git-path", "hooks"])
  if (hooks.exitCode !== 0) return false
  const folder = hooks.stdout.toString().trim()
  const names = Object.keys((Bun.YAML.parse(await config.text()) ?? {}) as object).filter((key) =>
    GIT_HOOKS.has(key),
  )
  for (const name of names) {
    const hook = Bun.file(`${folder}/${name}`)
    if (!(await hook.exists()) || !(await hook.text()).includes("lefthook")) return false
  }
  return run(["bunx", "lefthook", "check-install"]).exitCode === 0
}

if (!(await hooksMatch())) {
  const install = Bun.spawnSync(["bunx", "lefthook", "install"], {
    stdio: ["ignore", "inherit", "inherit"],
  })
  process.exit(install.exitCode ?? 1)
}
