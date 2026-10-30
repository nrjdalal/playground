import { homedir } from "node:os"
import { join } from "node:path"

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

// Why a stack cannot start its proxy here: portless asks for sudo to start one below port 1024, as on a fresh machine before `portless service install` keeps it on 443, and a stack gives it no terminal to ask in, so its own refusal scrolls past inside turbo's output.
export const proxyRefusal = async (
  env: Record<string, string | undefined>,
  dir = portlessDir(),
  listens = listening,
): Promise<string | null> => {
  if (env.PORTLESS === "0") return null
  const saved = Bun.file(join(dir, "proxy.port"))
  const port = (await saved.exists())
    ? Number((await saved.text()).trim())
    : Number(env.PORTLESS_PORT) || 443
  if (port >= 1024 || (await listens(port))) return null
  return `portless's proxy is not running, and starting it on port ${port} needs sudo, which a stack cannot ask for; once, in a terminal in the main checkout, run \`sudo node_modules/.bin/portless service install\` and then \`node_modules/.bin/portless trust\`, or start on fixed ports with \`PORTLESS=0 bun run dev\``
}
