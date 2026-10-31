import { userInfo } from "node:os"

// The Mac's Yard token in the macOS Keychain, as the signed-in user, through `security`: the local API and `playground yard` read it, so the token stays on this Mac and never reaches a browser.

export const KEYCHAIN_SERVICE = "playground-yard"

export type Run = (argv: string[]) => Promise<{ code: number; stderr: string; stdout: string }>

const spawnRun: Run = async (argv) => {
  const child = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, stderr, stdout }
}

export const keychain = (run: Run = spawnRun, account = userInfo().username) => {
  const item = ["-s", KEYCHAIN_SERVICE, "-a", account]
  return {
    read: async (): Promise<string | null> => {
      const found = await run(["security", "find-generic-password", ...item, "-w"])
      const token = found.stdout.trim()
      return found.code === 0 && token.startsWith("yard_") ? token : null
    },
    remove: async (): Promise<void> => {
      await run(["security", "delete-generic-password", ...item])
    },
    write: async (token: string): Promise<void> => {
      if (!/^yard_\S+$/.test(token)) throw new Error("a Yard token starts yard_")
      const wrote = await run(["security", "add-generic-password", "-U", ...item, "-w", token])
      if (wrote.code !== 0)
        throw new Error(`the Keychain refused the token: ${wrote.stderr.trim()}`)
    },
  }
}

export type Keychain = ReturnType<typeof keychain>
