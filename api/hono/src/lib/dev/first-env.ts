import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A fresh checkout's .env, started from .env.example with the one key a machine must make, BETTER_AUTH_SECRET, generated; an .env already there is never touched, and the secret reaches no output.
export const firstEnv = (root: string): string | null => {
  const env = join(root, ".env")
  const example = join(root, ".env.example")
  if (existsSync(env) || !existsSync(example)) return null
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")
  const text = readFileSync(example, "utf8").replace(
    /^BETTER_AUTH_SECRET=$/m,
    `BETTER_AUTH_SECRET=${secret}`,
  )
  writeFileSync(env, text, { flag: "wx", mode: 0o600 })
  return "started .env from .env.example, with a generated BETTER_AUTH_SECRET"
}
