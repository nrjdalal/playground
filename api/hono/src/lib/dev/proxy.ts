import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

// portless's state folder: PORTLESS_STATE_DIR, else ~/.portless, as portless's own.
export const portlessDir = (): string =>
  process.env.PORTLESS_STATE_DIR || join(homedir(), ".portless")

// Whether anything takes a connection on a loopback port.
export const listening = (port: number, timeout = 500): Promise<boolean> =>
  new Promise((done) => {
    const timer = setTimeout(() => done(false), timeout)
    const settle = (answered: boolean) => {
      clearTimeout(timer)
      done(answered)
    }
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
        open(socket) {
          socket.end()
          settle(true)
        },
      },
    }).catch(() => settle(false))
  })

// The unprivileged port a stack starts portless's proxy on while the one below 1024 is down: it needs no sudo, so no terminal, and every stack keeps its name on it.
export const FALLBACK_PORT = 1355

// The folder the 1355 proxy keeps its state in, inside portless's own: a service install reads portless's own folder alone, so it leaves this proxy, and every stack on it, running until each next start lands on 443.
export const fallbackDir = (dir: string): string => join(dir, "fallback")

// portless's own folder for a stack's state folder, the one a fallback folder sits in.
export const serviceDir = (dir: string): string =>
  basename(dir) === "fallback" ? dirname(dir) : dir

// The port portless serves on here: the one it saved, else PORTLESS_PORT, else 443.
export const proxyPort = async (
  env: Record<string, string | undefined>,
  dir = portlessDir(),
): Promise<number> => {
  const saved = Bun.file(join(dir, "proxy.port"))
  return (await saved.exists())
    ? Number((await saved.text()).trim())
    : Number(env.PORTLESS_PORT) || 443
}

// The port below 1024 portless's proxy belongs on and does not answer, which only sudo starts: a fresh machine before `portless service install` keeps it on 443, or a service that stopped; a saved 1355 that answers nothing reads as 443 down too, so its next start goes through startFallback, never portless's own start, which trusts the CA with no click; null when the stack skips portless, its port needs no sudo and answers, or the proxy answers.
export const proxyDown = async (
  env: Record<string, string | undefined>,
  dir = portlessDir(),
  listens = listening,
): Promise<number | null> => {
  if (env.PORTLESS === "0") return null
  const port = await proxyPort(env, dir)
  if (port === FALLBACK_PORT) return (await listens(port)) ? null : 443
  if (port >= 1024 || (await listens(port))) return null
  return port
}

// What the owner runs once, in a terminal, to put the proxy on its port below 1024: the setup a stack cannot do itself.
export const proxySetup = (port: number): string =>
  `portless's proxy is not running, and starting it on port ${port} needs sudo, which a stack cannot ask for; once, in a terminal in the main checkout, run \`sudo node_modules/.bin/portless service install\` and then \`node_modules/.bin/portless trust\`, or start on fixed ports with \`PORTLESS=0 bun run dev\``

// Starts portless's proxy on FALLBACK_PORT as this user, through the checkout's own portless (cli), with its trust step skipped, since trusting the certificate waits for the owner's click in Settings; answers why it is still not listening, else null. A proxy another stack started there first counts as started.
export const startFallback = async (
  cli: string,
  env: Record<string, string | undefined>,
  listens = listening,
): Promise<string | null> => {
  const run = Bun.spawnSync([cli, "proxy", "start", "-p", String(FALLBACK_PORT), "--skip-trust"], {
    env,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: 60_000,
  })
  if (await listens(FALLBACK_PORT, 2_000)) return null
  const said = Bun.stripANSI(`${run.stdout}${run.stderr}`).trim().split("\n").at(-1)
  return said || `portless exited ${run.exitCode ?? run.signalCode}`
}
