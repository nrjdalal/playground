import { z } from "zod"

// By relative path, as settings.ts imports, since tests outside the package import this file.
import { defineSettings } from "./settings"

// ops-firefighting-start's knobs: which tickets it starts for, the UTC hours and days it starts in, how fresh the relay's lines must be, the standing brief each firefighting worker starts from and the one a prepare-only worker starts from, the folder it opens in and the account it logs in as.
export const firefightingSettings = defineSettings({
  "firefighting.start.account": {
    default: "",
    description:
      "The Claude account a firefighting worker logs in as (spawn.sh's --account), an email whose token the Keychain keeps; empty starts it on spawn.sh's own pick.",
    schema: z.union([z.literal(""), z.email()]),
  },
  "firefighting.start.brief": {
    default: "brief-ff-ticket-template.md",
    description:
      "The standing brief under the data folder that ops-firefighting-start fills for each ticket, its {TICKET} and {NAME} replaced by the ticket's ID and the new worker's name.",
    schema: z.string().regex(/^[A-Za-z0-9._-]+\.md$/, "a brief's file name under the data folder"),
  },
  "firefighting.start.consultFrom": {
    default: "",
    description:
      'The UTC time, HH:MM inside firefighting.start.hours, from which ops-firefighting-start starts no listed ticket and tells the dispatcher "consult <id>" once per ticket, so the owner decides, while a prepare-only worker still starts; empty never consults.',
    schema: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM in UTC")]),
  },
  "firefighting.start.daysOff": {
    default: [],
    description:
      "The UTC dates (YYYY-MM-DD) ops-firefighting-start starts nothing on, as a day off; empty starts on every day.",
    schema: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a YYYY-MM-DD date")),
  },
  "firefighting.start.freshMinutes": {
    default: 10,
    description:
      "How many minutes old firefighting.json's lines may be (its lastTry, else its file time) for a start; older ones are a closed window's or a stopped relay's, so the job starts nothing and tells the Builder once.",
    schema: z.number().int().min(1).max(120),
  },
  "firefighting.start.hours": {
    default: "",
    description:
      "The UTC window ops-firefighting-start starts in, HH:MM-HH:MM (one past midnight wraps); outside it the job starts nothing and tells the Builder once; empty starts at any time.",
    schema: z.union([
      z.literal(""),
      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "HH:MM-HH:MM in UTC"),
    ]),
  },
  "firefighting.start.in": {
    default: "",
    description:
      "The folder a firefighting worker opens in (spawn.sh's --in), an absolute path; empty starts none, and the job tells the Builder this key is unset.",
    schema: z.union([z.literal(""), z.string().regex(/^\/.+/, "an absolute path")]),
  },
  "firefighting.start.prefixes": {
    default: [],
    description:
      "The ticket keys the job starts for (MADE for MADE-1), each a tracker team's key; empty starts none.",
    schema: z.array(z.string().regex(/^[A-Z][A-Z0-9]*$/, "a ticket key, upper case")),
  },
  "firefighting.start.prepareBrief": {
    default: "",
    description:
      "The standing brief under the data folder that ops-firefighting-start fills for a prepare-only worker, one for a ticket the relay's prepare map holds before the digest lists it, its {TICKET} and {NAME} replaced as for firefighting.start.brief; empty starts none.",
    schema: z.union([
      z.literal(""),
      z.string().regex(/^[A-Za-z0-9._-]+\.md$/, "a brief's file name under the data folder"),
    ]),
  },
})
