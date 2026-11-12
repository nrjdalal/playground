import type { AskedItem } from "../../../scripts/hooks/no-chat-question"

// Inbox items as bun run ask get prints them, each with what readStatus reads it as; a hidden one (archived, or put off with Later) stays out of the Inbox's list before inboxView sees it.
export const AFTER = "2026-11-06T10:00:00.000Z"
const BEFORE = "2026-11-01T10:00:00.000Z"
export const ITEMS: { hidden?: true; item: AskedItem; name: string; standing?: string }[] = [
  {
    item: { answer: null, kind: "update", readAt: null, status: "done", updatedAt: AFTER },
    name: "a posted update, unread",
    standing: "listed",
  },
  {
    item: { answer: null, kind: "update", readAt: AFTER, status: "done", updatedAt: AFTER },
    name: "a posted update the owner read",
    standing: "listed",
  },
  {
    item: { answer: null, kind: "update", readAt: BEFORE, status: "done", updatedAt: BEFORE },
    name: "an update read before the clocks stopped",
    standing: "done",
  },
  {
    item: {
      answer: { dismissedAt: AFTER },
      kind: "update",
      readAt: AFTER,
      status: "done",
      updatedAt: AFTER,
    },
    name: "an update the owner marked Done",
    standing: "done",
  },
  {
    item: {
      answer: { dismissed: true, dismissedAt: AFTER },
      kind: "update",
      readAt: AFTER,
      status: "done",
      updatedAt: AFTER,
    },
    name: "an update the owner dismissed",
    standing: "dismissed",
  },
  {
    item: {
      answer: { at: AFTER, by: "x", choice: "resolved" },
      kind: "update",
      readAt: AFTER,
      status: "done",
      updatedAt: AFTER,
    },
    name: "an update its poster resolved",
    standing: "done",
  },
  {
    hidden: true,
    item: {
      answer: { archivedAt: AFTER },
      kind: "update",
      readAt: AFTER,
      status: "done",
      updatedAt: AFTER,
    },
    name: "an update the owner archived",
    standing: "archived",
  },
  {
    hidden: true,
    item: {
      answer: { snoozedUntil: "2099-01-01T00:00:00.000Z" },
      kind: "update",
      readAt: null,
      status: "done",
      updatedAt: AFTER,
    },
    name: "an update the owner put off with Later",
    standing: "listed",
  },
  {
    item: { answer: null, kind: "decision", readAt: null, status: "open", updatedAt: AFTER },
    name: "an open decision",
    standing: "open",
  },
  {
    item: {
      answer: { at: AFTER, choice: "replied" },
      kind: "decision",
      readAt: AFTER,
      status: "open",
      updatedAt: AFTER,
    },
    name: "a decision the owner replied to",
    standing: "open",
  },
  {
    item: {
      answer: { ackedAt: AFTER, at: AFTER, choice: "replied" },
      kind: "decision",
      readAt: AFTER,
      status: "open",
      updatedAt: AFTER,
    },
    name: "a reply its poster acked",
  },
  {
    item: {
      answer: { at: AFTER, choice: "replied", dismissedAt: AFTER },
      kind: "decision",
      readAt: AFTER,
      status: "open",
      updatedAt: AFTER,
    },
    name: "a decision the owner replied to and dismissed",
  },
  {
    item: {
      answer: { at: AFTER, choice: "approve" },
      kind: "decision",
      readAt: AFTER,
      status: "approved",
      updatedAt: AFTER,
    },
    name: "an approved decision",
    standing: "approved",
  },
  {
    item: {
      answer: { at: AFTER, choice: "approve" },
      delivery: { status: "failed" },
      kind: "decision",
      readAt: AFTER,
      status: "approved",
      updatedAt: AFTER,
    },
    name: "an approved decision whose send failed",
    standing: "listed",
  },
  {
    item: {
      answer: { at: AFTER, choice: "deny" },
      kind: "decision",
      readAt: AFTER,
      status: "denied",
      updatedAt: AFTER,
    },
    name: "a denied decision",
    standing: "denied",
  },
  {
    item: {
      answer: { at: AFTER, by: "x", choice: "settled", dismissedAt: AFTER },
      kind: "decision",
      readAt: AFTER,
      status: "done",
      updatedAt: AFTER,
    },
    name: "a decision its poster settled",
    standing: "settled",
  },
  {
    hidden: true,
    item: {
      answer: { archivedAt: AFTER },
      kind: "decision",
      readAt: AFTER,
      status: "open",
      updatedAt: AFTER,
    },
    name: "an open decision the owner archived",
    standing: "archived while open",
  },
]
