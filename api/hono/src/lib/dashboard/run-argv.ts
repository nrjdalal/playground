// An argv run with no shell, its output read whole: the step a grant decision's Approve runs (ArgvRun in inbox.ts).
export const runArgv = async (argv: string[]) => {
  const child = Bun.spawn(argv, {
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: 30_000,
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code: code ?? 1, err: err.trim(), out: out.trim() }
}
