export type NoteCommit = { login: string | null; message: string; parents: number; sha: string }

export function renderNotes(_: {
  commits: NoteCommit[]
  from: string
  repo: string
  to: string
}): string {
  return ""
}
