import { existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"

// Names each dependency a workspace package declares that no node_modules from its folder up to the checkout holds, and exits 3 when there is one (bun's own failures exit 1), so link-skills.sh installs before it loads the workspace packages and on nothing else; it imports node built-ins alone, since it runs on a checkout whose links a pull has outgrown.

type Manifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: string[]
}

// `manifests`, each package.json's text by its path in the checkout, stands in for the disk's, so playground update can read a commit before the checkout moves onto it.
export const unlinked = async (
  repo: string,
  manifests?: Record<string, string>,
): Promise<string[]> => {
  const read = async (path: string): Promise<Manifest | undefined> => {
    if (manifests) return path in manifests ? JSON.parse(manifests[path] ?? "") : undefined
    const file = Bun.file(join(repo, path))
    return (await file.exists()) ? file.json() : undefined
  }
  const root = await read("package.json")
  if (!root) return []
  const files = (root.workspaces ?? []).flatMap((pattern) => {
    const glob = new Bun.Glob(`${pattern}/package.json`)
    return manifests
      ? Object.keys(manifests).filter((path) => glob.match(path))
      : [...glob.scanSync({ cwd: repo })]
  })
  const linked = (folder: string, name: string): boolean =>
    existsSync(join(folder, "node_modules", name, "package.json")) ||
    (folder !== repo && linked(dirname(folder), name))
  const missing: string[] = []
  for (const file of files) {
    const manifest = (await read(file)) ?? {}
    const folder = dirname(join(repo, file))
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
      if (!linked(folder, name)) missing.push(`${relative(repo, folder)}: ${name}`)
  }
  return missing
}

if (import.meta.main) {
  const missing = await unlinked(process.argv[2] ?? join(import.meta.dir, "..", "..", "..", ".."))
  for (const line of missing) console.error(`unlinked ${line}`)
  process.exit(missing.length ? 3 : 0)
}
