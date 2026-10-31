// commit-scope.ts <message file>: lefthook's commit-msg step, refusing a message whose (PG-<n>) scope names another item than the branch's PG-<n>- prefix, since a commit made on the wrong branch carries its item's scope there and conflicts later.

// Pure: the refusal for a subject on a branch, or undefined when it passes: a branch with no PG- prefix, or a subject with no PG scope, passes.
export function scopeRefusal(subject: string, branch: string): string | undefined {
  // the last scope, since a revert quotes the reverted subject's scope before its own
  const scope = [...subject.matchAll(/\((PG-\d+)\)/gi)].at(-1)?.[1]
  const prefix = /^(PG-\d+)-/i.exec(branch)?.[1]
  if (!scope || !prefix || scope.toUpperCase() === prefix.toUpperCase()) return undefined
  return `commit-scope: the message names (${scope.toUpperCase()}), but the branch ${branch} is ${prefix.toUpperCase()}: commit it on ${scope.toUpperCase()}'s branch, or give it ${prefix.toUpperCase()}'s scope`
}

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) {
    console.error("usage: commit-scope.ts <message file>")
    process.exit(2)
  }
  const subject = (await Bun.file(file).text()).split("\n")[0] ?? ""
  const head = Bun.spawnSync(["git", "symbolic-ref", "--short", "-q", "HEAD"], { stderr: "ignore" })
  const refusal = scopeRefusal(subject, head.stdout.toString().trim())
  if (refusal) {
    console.error(refusal)
    process.exit(1)
  }
}
