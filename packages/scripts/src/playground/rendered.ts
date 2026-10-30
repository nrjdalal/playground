import { dataDir } from "../../../env/src/data-dir"
import { readRendered } from "../../../settings/src/rendered"

// The store's reader for a caller that is not TypeScript (a shell or Python script): `bun packages/scripts/src/playground/rendered.ts <file>` prints the path of <file> in the store's folder, exit 0; exits 3 on a machine with no store, so the caller takes its own default; exits 2 with the refusal on stderr when the store lacks the file.
export const readerExit = async (
  file: string | undefined,
  environment: Record<string, string | undefined>,
  out: (line: string) => void,
  err: (line: string) => void,
): Promise<number> => {
  if (!file) {
    err("usage: bun packages/scripts/src/playground/rendered.ts <file in the store>")
    return 2
  }
  const read = await readRendered(dataDir(environment), file)
  if (read.refusal) {
    err(read.refusal)
    return 2
  }
  if (!read.path) return 3
  out(read.path)
  return 0
}

if (import.meta.main)
  process.exit(await readerExit(process.argv[2], process.env, console.log, console.error))
