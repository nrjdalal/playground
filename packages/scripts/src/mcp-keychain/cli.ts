// Starts an MCP server with a token from the Keychain in its env alone: `bun --no-env-file cli.ts <service> <account> <ENV_NAME> -- <command...>`, so the config that names the server holds no secret, and the token reaches no argv, file or output.
const [service, account, envName, dashes, ...command] = Bun.argv.slice(2)
if (!service || !account || !envName || dashes !== "--" || !command.length) {
  console.error("usage: mcp-keychain <service> <account> <ENV_NAME> -- <command...>")
  process.exit(2)
}

const read = Bun.spawnSync(
  ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
  {
    stderr: "ignore",
    stdout: "pipe",
  },
)
const token = read.stdout.toString().trim()
if (read.exitCode !== 0 || !token) {
  console.error(
    `mcp-keychain: the Keychain holds no ${service} item for ${account}, so the server is not started`,
  )
  process.exit(1)
}

const child = Bun.spawn(command, {
  env: { ...process.env, [envName]: token },
  stderr: "inherit",
  stdin: "inherit",
  stdout: "inherit",
})
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => child.kill(signal))
process.exit(await child.exited)

export {}
