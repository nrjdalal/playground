import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { apiHono, auth, db, redis, webNext } from "@/keys"

// What each env schema requires, read from the schemas themselves and never a second list: a key whose validation refuses the value the app would read, so a checkout missing it, or leaving it blank, is named here rather than failing far from the cause. Judged on the values the apps' own validation reads, so a skip flag's stand-in counts as set. Server-side only: it reads .env.example and runs its read in a child process.

type Schema = {
  client?: Record<string, { safeParse: (value: unknown) => { success: boolean } }>
  runtimeEnv: Record<string, string | undefined>
  server?: Record<string, { safeParse: (value: unknown) => { success: boolean } }>
}

// The schemas by the app that reads them, in A to Z order.
const SCHEMAS: Record<string, Schema> = {
  "api-hono": apiHono,
  auth,
  db,
  redis,
  "web-next": webNext,
}

// The keys of one schema that read as required: a key whose validation refuses the value its app would read, an empty one included, since emptyStringAsUndefined reads that as unset. A key with a default, an optional one, or one a skip flag stands in for, never appears.
const requiredOf = (schema: Schema): string[] => {
  const shapes = { ...schema.server, ...schema.client }
  return Object.keys(shapes).filter((key) => {
    const value = schema.runtimeEnv[key]
    return !shapes[key]!.safeParse(value === "" ? undefined : value).success
  })
}

// Every required key with the apps that read it, A to Z by key.
export const requiredKeys = (): Map<string, string[]> => {
  const keys = new Map<string, string[]>()
  for (const [target, schema] of Object.entries(SCHEMAS)) {
    for (const key of requiredOf(schema)) {
      const targets = keys.get(key) ?? []
      if (!targets.includes(target)) targets.push(target)
      keys.set(key, targets)
    }
  }
  return new Map([...keys].sort(([a], [b]) => (a < b ? -1 : 1)))
}

export type EnvGaps = { empty: string[]; missing: string[] }

// The keys .env.example documents, the ones a person can fill, read from the checkout the way load-dotenv reads ../../.env from the API's working directory; null when it cannot be read, so every required key is named.
const exampleKeys = (): string[] | null => {
  try {
    const example = readFileSync(join(process.cwd(), "../../.env.example"), "utf8")
    return [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!)
  } catch {
    return null
  }
}

// What the environment is missing or leaves empty among the required keys, each named with the apps that read it, as the apps' own validation would fail on it. Reads the values the schemas read at their load, so call with .env already staged. A required key .env.example does not hold (a derived one, such as NEXT_PUBLIC_NODE_ENV from NODE_ENV) is never named, since no .env line can set it, nor is one the caller names in `optional` (the dev launcher's POSTGRES_URL, which setup fills).
export const envGaps = (optional: string[] = []): EnvGaps => {
  const settable = exampleKeys()
  const empty: string[] = []
  const missing: string[] = []
  for (const [key, targets] of requiredKeys()) {
    if (settable && !settable.includes(key)) continue
    if (optional.includes(key)) continue
    const value = targets
      .map((target) => SCHEMAS[target]!.runtimeEnv[key])
      .find((v) => v !== undefined)
    if (value === undefined) missing.push(`${key} (${targets.join(", ")})`)
    else if (value === "") empty.push(`${key} (${targets.join(", ")})`)
  }
  return { empty, missing }
}

// The launcher's refusal for a .env with gaps, naming each key with the apps that read it.
export const gapsRefusal = ({ empty, missing }: EnvGaps): string => {
  const parts = [
    missing.length > 0 ? `the .env lacks keys the apps require: ${missing.join(", ")}` : null,
    empty.length > 0 ? `left empty: ${empty.join(", ")}` : null,
  ].filter(Boolean)
  const named = parts.join("; ")
  return named.length > 0 ? `${named}; fill each from .env.example` : "fill each from .env.example"
}

export type GapsRead = ({ ok: true; refusal: string } & EnvGaps) | { error: string; ok: false }

// What a checkout's .env is missing or leaves empty, read in a child of the caller's so .env is staged as the apps stage it: the child loads the loader beside this module in dist, then reports envGaps() and its refusal from the working directory given, whose ../../.env and ../../.env.example are that checkout's own. The refusal travels with the gaps, so a caller that read the module lazily never needs this module again.
export const readEnvGaps = (
  cwd: string,
  env: Record<string, string | undefined>,
  optional: string[] = [],
): GapsRead => {
  const read = spawnSync(
    process.execPath,
    [
      "--no-env-file",
      "-e",
      `await import(${JSON.stringify(new URL("./load-dotenv.mjs", import.meta.url).href)}); const { envGaps, gapsRefusal } = await import(${JSON.stringify(import.meta.url)}); const gaps = envGaps(${JSON.stringify(optional)}); process.stdout.write(JSON.stringify({ ...gaps, refusal: gapsRefusal(gaps) }))`,
    ],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
  )
  if (read.status !== 0) {
    return {
      error: read.stderr?.toString().trim().slice(0, 500) || "the child gave no error",
      ok: false,
    }
  }
  return { ...(JSON.parse(read.stdout!.toString()) as { refusal: string } & EnvGaps), ok: true }
}
