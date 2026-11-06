import { z } from "zod"

import { defineSettings } from "@/settings"

const file = z.string()
const hhmm = z.string().regex(/^(?:[01]\d|2[0-4]):[0-5]\d$/, "a UTC time, HH:MM")

// The ticket progress card's inputs (ops-ticket-card): each file is a path, absolute or in the data folder, and an empty one reads as none, so a Mac with no lines file set keeps no card.
export const ticketCardSettings = defineSettings({
  "ticketCard.approvals": {
    default: 2,
    description: "The approvals a ticket's pull request waits for, which the card counts toward.",
    schema: z.number().int().positive(),
  },
  "ticketCard.diaryDir": {
    default: "diary",
    description:
      "The folder, absolute or in the data folder, where the card's job appends each step it first sees to that day's <YYYY-MM-DD>-steps.md.",
    schema: z.string().min(1),
  },
  "ticketCard.linesFile": {
    default: "",
    description:
      "The file of the day's watched tickets the card reads, a JSON object whose lines record holds each ticket's line and whose clock record names the tickets the card shows; none until set, so the job keeps no card.",
    schema: file,
  },
  "ticketCard.linkBase": {
    default: "",
    description:
      "The URL a ticket's id is appended to for its link on the card; none until set, so the card links pull requests alone.",
    schema: z.union([z.literal(""), z.string().url()]),
  },
  "ticketCard.prefixes": {
    default: [] as string[],
    description: "The ticket id prefixes the card shows; none means every prefix.",
    schema: z.array(z.string().regex(/^[A-Z][A-Z0-9]*$/, "an uppercase ticket prefix")),
  },
  "ticketCard.reopenedFile": {
    default: "",
    description:
      "The file whose reopened record maps a ticket's id to when it was seen reopened, which the card marks; none until set.",
    schema: file,
  },
  "ticketCard.skipsFile": {
    default: "",
    description:
      "The sent record whose <kind>-skip:<ticket>:<area> keys mark a ticket skipped for an area, which the card shows so; none until set.",
    schema: file,
  },
  "ticketCard.title": {
    default: "Tickets today",
    description: "The card's title.",
    schema: z.string().min(1),
  },
  "ticketCard.verdictsFile": {
    default: "",
    description:
      "The file mapping a ticket's id to its triage verdict, { at, kind }, which the card shows as its cause found; none until set.",
    schema: file,
  },
  "ticketCard.window": {
    default: { days: [0, 1, 2, 3, 4, 5, 6], end: "24:00", start: "00:00" },
    description:
      "The UTC hours on the weekdays (0 is Sunday) the card's job writes in; outside them it writes nothing.",
    schema: z.object({ days: z.array(z.number().int().min(0).max(6)), end: hhmm, start: hhmm }),
  },
})
