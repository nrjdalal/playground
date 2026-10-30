import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"

import { restart, type Run } from "./restart"

const [checkout, from, to] = process.argv.slice(2)
if (!checkout || !from || !to) {
  console.error("usage: ops-restart/cli.ts <checkout> <old sha> <new sha>")
  process.exit(2)
}

const run: Run = async (argv) => {
  const proc = Bun.spawn(argv, {
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: 300_000,
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, out: out + err }
}

const lines = await restart({
  checkout,
  from,
  ops: join(dataDir(), "ops"),
  run,
  to,
})
for (const line of lines) console.log(`ops-restart: ${line}`)
