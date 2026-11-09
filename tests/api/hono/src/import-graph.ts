import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

export const ROOT = resolve(import.meta.dir, "../../../..")
export const SRC = join(ROOT, "api/hono/src")

const transpiler = new Bun.Transpiler({ loader: "ts" })

const resolveFile = (base: string): string | null =>
  [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(
    (file) => existsSync(file) && statSync(file).isFile(),
  ) ?? null

// The src folder a file's @/ alias points into: the API's, or the workspace package's it sits in.
const srcOf = (file: string) => file.match(/^(.*\/packages\/[^/]+\/src)\//)?.[1] ?? SRC

// A workspace package's import, @packages/<name>[/<sub>], as the source file its export builds from.
const packageFile = (path: string) => {
  const [, name, sub] = path.match(/^@packages\/([^/]+)(?:\/(.+))?$/) ?? []
  return name ? resolveFile(join(ROOT, "packages", name, "src", sub ?? "index")) : null
}

// Every file the entry reaches through runtime imports, static and, unless told otherwise, dynamic (type-only imports are erased), into the workspace packages too, with every package it names; an API file is named from api/hono/src, a package's from the repo root.
export const importGraph = (entry: string, { dynamic = true } = {}) => {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    for (const { kind, path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path.startsWith("node:") || path === "bun") continue
      if (!dynamic && kind === "dynamic-import") continue
      const parts = path.split("/")
      if (!path.startsWith("@/") && !path.startsWith(".")) {
        packages.add(path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!)
        if (!path.startsWith("@packages/")) continue
      }
      const local = path.startsWith("@/")
        ? join(srcOf(file), path.slice(2))
        : path.startsWith(".")
          ? resolve(dirname(file), path)
          : null
      const found = local ? resolveFile(local) : packageFile(path)
      if (!found)
        throw new Error(`${relative(ROOT, file)} imports ${path}, which resolves to no file`)
      if (/\.tsx?$/.test(found)) queue.push(found)
    }
  }
  const named = (file: string) =>
    file.startsWith(`${SRC}/`) ? relative(SRC, file) : relative(ROOT, file)
  return { files: [...files].map(named), packages: [...packages] }
}
