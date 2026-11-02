import { existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"

// Names each dependency a workspace package declares that no node_modules from its folder up to the checkout holds, and exits 1 when there is one, so link-skills.sh installs before it loads the workspace packages; it imports node built-ins alone, since it runs on a checkout whose links a pull has outgrown.

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

export const unlinked = async (repo: string): Promise<string[]> => {
  if (!(await Bun.file(join(repo, "package.json")).exists())) return []
  const root = (await Bun.file(join(repo, "package.json")).json()) as Manifest & {
    workspaces?: string[]
  }
  const folders = [
    repo,
    ...(root.workspaces ?? []).flatMap((pattern) =>
      [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: repo })].map((file) =>
        dirname(join(repo, file)),
      ),
    ),
  ]
  const linked = (folder: string, name: string): boolean =>
    existsSync(join(folder, "node_modules", name, "package.json")) ||
    (folder !== repo && linked(dirname(folder), name))
  const missing: string[] = []
  for (const folder of folders) {
    const manifest = (await Bun.file(join(folder, "package.json")).json()) as Manifest
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
      if (!linked(folder, name)) missing.push(`${relative(repo, folder) || "."}: ${name}`)
  }
  return missing
}

if (import.meta.main) {
  const missing = await unlinked(process.argv[2] ?? join(import.meta.dir, "..", "..", "..", ".."))
  for (const line of missing) console.error(`unlinked ${line}`)
  process.exit(missing.length ? 1 : 0)
}
