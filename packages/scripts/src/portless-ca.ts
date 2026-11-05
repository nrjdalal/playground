import { existsSync } from "node:fs"
import { join } from "node:path"

import { portlessDir } from "../../../api/hono/src/lib/dev/proxy"

export { portlessDir }

// portless's CA, in its state folder, when this process was started without an extra CA of its own.
export const portlessCa = (env: NodeJS.ProcessEnv = process.env): string | null => {
  if (env.NODE_EXTRA_CA_CERTS) return null
  const ca = join(portlessDir(env), "ca.pem")
  return existsSync(ca) ? ca : null
}

// Bun's fetch and WebSocket check a certificate against Bun's own store, never the keychain `portless trust` writes, and read NODE_EXTRA_CA_CERTS only as the process starts: so a client of an https stack whose requests cannot each carry portless's CA as their `tls` runs itself again with it, and exits with that run's code.
export const withPortlessCa = async (): Promise<void> => {
  const ca = portlessCa()
  if (!ca) return
  const child = Bun.spawn([process.execPath, ...process.execArgv, ...process.argv.slice(1)], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: ca },
    stdio: ["inherit", "inherit", "inherit"],
  })
  process.exit(await child.exited)
}
