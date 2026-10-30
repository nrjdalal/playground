import { writeRoot } from "../../../packages/settings/src/folder"
import { extensionsDir } from "../../../packages/settings/src/rendered"

// A data folder whose extensions root holds each guard list given, by its file name (playground-terms.json) as its text, at the path a guard reads it from, and the policy.json every write derives with the settings given.
export const storeWith = (
  data: string,
  lists: Record<string, string>,
  values: Record<string, unknown> = {},
): string => {
  const files = new Map(Object.entries(lists).map(([file, text]) => [`hooks/${file}`, text]))
  files.set("policy.json", JSON.stringify({ orgs: {}, schemaVersion: 1, values }))
  writeRoot(extensionsDir(data), files)
  return data
}
