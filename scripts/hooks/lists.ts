// A guard's list, read so the guard fails closed: a list file that is there means its guard is configured, so one that is empty, malformed or wrongly shaped refuses, as does a missing one on a machine whose data folder holds the store's marker; a missing one with no marker is a stranger's clone, which takes the empty default.
import { existsSync } from "node:fs"

import { dataDir } from "../../packages/env/src/data-dir"
import { type GUARD_LISTS, markerPath, readRendered } from "../../packages/settings/src/rendered"

type Environment = Record<string, string | undefined>

export type Loaded<T> = { list: T; refusal?: undefined } | { list?: undefined; refusal: string }

// The store's folder: made at its first write and never removed, so a machine with a store never falls back to a list in the checkout.
export const storeMarker = (environment: Environment = process.env): string =>
  markerPath(dataDir(environment))

// The one way a guard reads its list: from the store's folder on a machine with a store, else from its file in the checkout, else, with neither, its empty default.
export async function guardList<T>(
  guard: string,
  name: (typeof GUARD_LISTS)[number],
  valid: (value: unknown) => value is T,
  empty: T,
  environment: Environment = process.env,
  file?: string,
): Promise<Loaded<T>> {
  const read = await readRendered(dataDir(environment), `hooks/${name}.json`)
  if (read.refusal)
    return { refusal: `${guard} hook refused this call: ${read.refusal}, then run the call again.` }
  const path = read.path ?? file
  return path ? loadList(guard, path, valid, empty, environment) : { list: empty }
}

// A list is the shape `valid` checks, its every key present; an explicit empty list is the owner's choice and loads.
export async function loadList<T>(
  guard: string,
  path: string,
  valid: (value: unknown) => value is T,
  empty: T,
  environment: Environment = process.env,
): Promise<Loaded<T>> {
  const refuse = (what: string): Loaded<T> => ({
    refusal: `${guard} hook refused this call: its list ${path} ${what}, so it cannot check the call. Restore the file (git checkout -- it, in the checkout that holds it) or fix it, then run the call again.`,
  })
  if (!existsSync(path))
    return existsSync(storeMarker(environment))
      ? refuse(`is missing on a machine with a store (${storeMarker(environment)})`)
      : { list: empty }
  let value: unknown
  try {
    value = JSON.parse(await Bun.file(path).text())
  } catch (error) {
    return refuse(`is not JSON (${error})`)
  }
  return valid(value) ? { list: value } : refuse("lacks a key or holds a value of the wrong type")
}

export const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
