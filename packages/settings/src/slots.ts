import { z } from "zod"

// By relative path, as settings.ts imports, since tests outside the package import this file.
import { defineSettings } from "./settings"

// run-slot's knobs: how many runs that mostly wait on a model may hold a slot at once, counted apart from the CPU slots, the other factories on this machine whose heavy runs count against them, and the job whose hours keep an org's runs a lane.
export const slotSettings = defineSettings({
  "slots.modelBound": {
    default: 2,
    description:
      "How many runs that mostly wait on a model (run-slot.sh <who> --model-bound -- <command>, such as a parity replay) hold a slot at once, counted apart from the CPU slots, so one never holds a CPU slot while its CPU idles.",
    schema: z.number().int().min(1).max(16),
  },
  "slots.peers": {
    default: [],
    description:
      "The ops folders of other factories on this machine, each an absolute path: run-slot counts each live holder of their run slots against this factory's load units, and spawn.sh's load gate counts their starts beside its own, both reading only.",
    schema: z.array(z.string().regex(/^\/.+/, "an absolute path")),
  },
  "slots.windowJob": {
    default: "",
    description:
      "The jobs.json row whose config.hours and daysOff hold an org's window, empty for none: while it stands, run-slot keeps an org's runs a free lane and spawn.sh gives a start in an org's checkout the priority path, though not focus.",
    schema: z.string().regex(/^(?:[a-z0-9][a-z0-9-]*)?$/, "a job's name, or empty"),
  },
})
