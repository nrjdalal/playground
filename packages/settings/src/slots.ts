import { z } from "zod"

// By relative path, as settings.ts imports, since tests outside the package import this file.
import { defineSettings } from "./settings"

// run-slot's knobs: how many runs that mostly wait on a model may hold a slot at once, counted apart from the CPU slots.
export const slotSettings = defineSettings({
  "slots.modelBound": {
    default: 2,
    description:
      "How many runs that mostly wait on a model (run-slot.sh <who> --model-bound -- <command>, such as a parity replay) hold a slot at once, counted apart from the CPU slots, so one never holds a CPU slot while its CPU idles.",
    schema: z.number().int().min(1).max(16),
  },
})
