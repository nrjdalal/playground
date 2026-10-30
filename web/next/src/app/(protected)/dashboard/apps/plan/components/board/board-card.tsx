"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "cn"

import { AgentLink } from "@/components/dashboard/agent-link"
import { Hint } from "@/components/hint"
import { prLabel, statusLabel } from "@/lib/plan"
import type { BoardCard as Card } from "@/lib/plan-board"

// A keystroke on the card's links is theirs, never the start of a keyboard move.
const own = (event: React.KeyboardEvent) => event.stopPropagation()

// A card's lines at the sidebar's sizes: its id and title with its pull request, the plain-words line for the owner, then its worker, its lane (where the column does not already say it), estimate and status in words, then its tags as text.
export function CardLines({
  card,
  column,
  lanes,
}: {
  card: Card
  column?: string
  lanes: Record<string, string>
}) {
  const meta = [
    card.lane && card.lane !== column ? lanes[card.lane] : null,
    card.estimateRange,
    card.status ? statusLabel(card.status) : null,
  ].filter(Boolean)
  return (
    <>
      <div className="flex items-center gap-1">
        <Hint content={card.title}>
          <span className="min-w-0 flex-1 truncate text-xs leading-3.5">
            {!card.id.startsWith("done:") && (
              <span className="text-muted-foreground">{card.id} </span>
            )}
            {card.title}
          </span>
        </Hint>
        {card.pr && (
          <a
            href={card.pr}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs leading-3.5 tabular-nums hover:underline"
            onKeyDown={own}
          >
            {prLabel(card.pr)}
          </a>
        )}
      </div>
      {card.outcome !== card.title && (
        <Hint content={card.outcome}>
          <p className="text-muted-foreground text-2xs line-clamp-2 leading-3">{card.outcome}</p>
        </Hint>
      )}
      {(card.worker || meta.length > 0) && (
        <div className="text-muted-foreground text-2xs min-w-0 truncate leading-3">
          {card.worker && (
            <span onKeyDown={own}>
              <AgentLink name={card.worker} />
            </span>
          )}
          {card.worker && meta.length > 0 ? " · " : null}
          {meta.join(" · ")}
        </div>
      )}
      {card.tags.length > 0 && (
        <Hint content={card.tags.join(" · ")}>
          <div className="text-muted-foreground text-2xs truncate leading-3">
            {card.tags.join(" · ")}
          </div>
        </Hint>
      )}
    </>
  )
}

const CARD = "bg-card flex flex-col gap-1 rounded-md border p-2"

// A queued card: dragged by the pointer anywhere on it, or picked up with Space or Enter, moved with the arrow keys and dropped with Space or Enter again (Escape puts it back).
export function SortableCard({
  card,
  column,
  lanes,
}: {
  card: Card
  column: string
  lanes: Record<string, string>
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    attributes: { role: "listitem", roleDescription: "queued item" },
    id: card.id,
  })
  return (
    <li
      ref={setNodeRef}
      data-card-id={card.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        CARD,
        "focus-visible:ring-ring/50 cursor-grab outline-none focus-visible:ring-[3px]",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <CardLines card={card} column={column} lanes={lanes} />
    </li>
  )
}

// A card that moves by itself as the work does (in flight, in review, done), so it cannot be dragged.
export function FixedCard({ card, lanes }: { card: Card; lanes: Record<string, string> }) {
  return (
    <li className={CARD}>
      <CardLines card={card} lanes={lanes} />
    </li>
  )
}

// The card under the pointer while it is dragged.
export function OverlayCard({ card, lanes }: { card: Card; lanes: Record<string, string> }) {
  return (
    <div className={cn(CARD, "shadow-md")}>
      <CardLines card={card} lanes={lanes} />
    </div>
  )
}
