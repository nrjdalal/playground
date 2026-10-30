import { z } from "zod"

import { DEBUG_REPORTS_KEPT, debugReportsDir, storeDebugReport } from "./debug-report"

// TEMPORARY (open until then): the composer's report of a dictation that never landed, with the browser's paste log (web/next/src/lib/paste-log.ts) behind it; remove both once a reported miss is explained, or 7 days after this reaches the live dashboard with no miss reported.

export const PASTE_REPORTS_KEPT = DEBUG_REPORTS_KEPT
// A report holds the browser's whole log at most (a page load's), within PASTE_REPORT_BYTES.
export const PASTE_REPORT_ENTRIES = 200
export const PASTE_REPORT_BYTES = 128 * 1024

// An element as the paste log names it (#id, else its tag and slot, or none) and a clipboard type: each one token with no spaces, from the page's own code or the browser's lists, so a dictated sentence never fits.
const name = z.string().regex(/^\S{1,100}$/)

// One entry of the browser's paste log: names, lengths, timing and types, never the words. Any other field is dropped; cause and reached may be missing, as on a page from before them.
const entrySchema = z.object({
  active: name,
  at: z.iso.datetime(),
  boxLength: z.number().int().nonnegative(),
  cause: z.enum(["empty-insert", "remount", "reset"]).nullish(),
  delay: z.number().int().nonnegative(),
  event: z.enum([
    "beforeinput",
    "blur",
    "emptied",
    "focus",
    "focusout",
    "input",
    "keydown",
    "mount",
    "paste",
    "unmount",
    "visibilitychange",
  ]),
  inBox: z.boolean().nullable(),
  inputType: z
    .string()
    .regex(/^[A-Za-z]{1,40}$/)
    .nullable(),
  length: z.number().int().nonnegative(),
  mount: name,
  prevented: z.boolean(),
  reached: z.enum(["box", "field", "none", "stopped"]).nullish(),
  related: name,
  target: name,
  types: z.array(z.string().regex(/^\S{1,60}$/)).max(8),
  visible: z.boolean().nullable(),
})

// emptied: the box went empty within 3 seconds of a paste the box let in, with no key or press of his; empty-paste: a paste into the box carried no text and no file; load: a page load sent the whole log, since it held a miss newer than the last one a load sent; no-paste: a Cmd+V aimed at the box brought no paste within a second; off-box: a Cmd+V reached nothing that takes text.
export const pasteReportSchema = z.object({
  entries: z.array(entrySchema).min(1).max(PASTE_REPORT_ENTRIES),
  miss: z.enum(["emptied", "empty-paste", "load", "no-paste", "off-box"]),
})

export type PasteReport = z.infer<typeof pasteReportSchema>

// $PLAYGROUND_DEBUG_PASTE_DIR when set, else debug/paste in the data folder (debugReportsDir).
export const pasteReportsDir = (): string => debugReportsDir("paste")

// Keeps one report as its own owner-only file, the newest PASTE_REPORTS_KEPT left (storeDebugReport). Returns the file's name.
export const storePasteReport = (
  report: PasteReport,
  { dir = pasteReportsDir(), now }: { dir?: string; now?: Date } = {},
): Promise<string> => storeDebugReport({ entries: report.entries, miss: report.miss }, { dir, now })
