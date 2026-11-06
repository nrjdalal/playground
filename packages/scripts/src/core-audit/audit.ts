// core-audit's two legs, stubbed for the red tests.
import type { File } from "../trace-count/count"

export type Hit = { kind: string; leg: 1 | 2; line: number; path: string; where: string }
export type Terms = { keys: string[]; orgs: string[] }

export const orgTerms = (_env: Record<string, string | undefined>): Terms | undefined => ({
  keys: [],
  orgs: [],
})
export const leg1 = (_files: File[], _terms: Terms): Hit[] => []
export const leg2 = (_files: File[]): Hit[] => []
export const line = (_hit: Hit): string => ""
