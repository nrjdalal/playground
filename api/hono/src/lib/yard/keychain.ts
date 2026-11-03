import { userInfo } from "node:os"

// The Mac's Yard token in the macOS Keychain, as the signed-in user, through `security`: the local API and `playground yard` read it, so the token stays on this Mac and never reaches a browser.

export const KEYCHAIN_SERVICE = "playground-yard"

// input goes to the command's stdin, so a secret travels there and never in an argv another process can read
export type Run = (
  argv: string[],
  input?: string,
) => Promise<{ code: number; stderr: string; stdout: string }>

const spawnRun: Run = async (argv, input) => {
  const child = Bun.spawn(argv, {
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
  })
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
    // through `security -i` on stdin, as packages/settings' writer does, so no argv holds the token; both words sit in double quotes, so each must hold none
    write: async (token: string): Promise<void> => {
      if (!/^yard_[A-Za-z0-9_-]+$/.test(token)) throw new Error("a Yard token starts yard_")
      if (!/^[A-Za-z0-9._+@-]+$/.test(account)) throw new Error(`${account} is not an account name`)
      const wrote = await run(
        ["security", "-i"],
        `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account}" -w "${token}"\n`,
      )
      if (wrote.code !== 0 || wrote.stderr.trim())
        throw new Error(`the Keychain refused the token: ${wrote.stderr.trim()}`)
    },
  }
}

export type Keychain = ReturnType<typeof keychain>
