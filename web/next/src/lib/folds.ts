import { useState } from "react"

// One accordion item: its value, and whether it starts open by its own state.
export type Fold = { id: string; open: boolean }

// What he set each item to, kept with the start it was picked against.
export type Picks = ReadonlyMap<string, { from: boolean; open: boolean }>

// Pure: the items open now, each as he left it, else as its state starts it.
export const openFolds = (folds: Fold[], picks: Picks): string[] =>
  folds.filter((fold) => picks.get(fold.id)?.open ?? fold.open).map((fold) => fold.id)

// Pure: his picks once the accordion reads `next` open, recording only the items whose state he changed.
export function pickFolds(folds: Fold[], picks: Picks, next: string[]): Picks {
  const was = openFolds(folds, picks)
  const kept = new Map(picks)
  for (const fold of folds) {
    const open = next.includes(fold.id)
    if (open !== was.includes(fold.id)) kept.set(fold.id, { from: fold.open, open })
  }
  return kept
}

// Pure: the picks whose item is still there and still starts as it did when picked, so an item that changes state takes its own start again; the same map when none went.
export function keepPicks(folds: Fold[], picks: Picks): Picks {
  const starts = new Map(folds.map((fold) => [fold.id, fold.open]))
  const kept = new Map([...picks].filter(([id, pick]) => starts.get(id) === pick.from))
  return kept.size === picks.size ? picks : kept
}

// The open items of one multiple Accordion, each starting as its state says and then as he leaves it, held in memory alone, so a reload starts each from its state again.
export function useFolds(folds: Fold[]) {
  const [picks, setPicks] = useState<Picks>(new Map())
  const kept = keepPicks(folds, picks)
  if (kept !== picks) setPicks(kept)
  const value = openFolds(folds, kept)
  const onValueChange = (next: string[]) => setPicks(pickFolds(folds, kept, next))
  return { onValueChange, value }
}
