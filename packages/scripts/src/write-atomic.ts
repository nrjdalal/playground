import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

// Written to a temp file of its own beside it, then renamed, so a reader never sees half a file and two writes never share one; 0600 (writeFile, since Bun.write leaves the mode to the umask), as what the ops jobs write can name people and their emails.
export async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temp, text, { mode: 0o600 })
  await rename(temp, path)
}
