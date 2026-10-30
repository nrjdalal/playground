"use client"

import type { Plan } from "@api/hono"
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragOverEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import { useMemo, useRef, useState } from "react"

import {
  FixedCard,
  OverlayCard,
  SortableCard,
} from "@/app/(protected)/dashboard/apps/plan/components/board/board-card"
import { toast } from "@/components/ui/toast"
import { PLAN_QUERY_KEY } from "@/lib/plan"
import {
  boardColumns,
  laneOf,
  queuedIds,
  sameOrder,
  saveOrder,
  standing,
  type BoardCard,
  type BoardColumn,
  type OrderLanes,
} from "@/lib/plan-board"

const INSTRUCTIONS =
  "A queued item is picked up with Space or Enter, moved with the arrow keys, within its lane or to another, and dropped with Space or Enter; Escape puts it back. Each drop saves the order, and the planner builds in that order."

// Pure: the lanes after a card is dragged over another lane, placed where the pointer is: above the card it is over, or below it once past its middle, or at the end of an empty lane.
function overLane(ids: OrderLanes, event: DragOverEvent): OrderLanes | null {
  const { active, over } = event
  if (!over) return null
  const id = String(active.id)
  const from = laneOf(ids, id)
  const to = String(over.id) in ids ? String(over.id) : laneOf(ids, String(over.id))
  if (!from || !to || from === to) return null
  const target = ids[to]!
  const overIndex = target.indexOf(String(over.id))
  const below =
    active.rect.current.translated !== null &&
    active.rect.current.translated.top > over.rect.top + over.rect.height / 2
  const index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0)
  return {
    ...ids,
    [from]: ids[from]!.filter((other) => other !== id),
    [to]: [...target.slice(0, index), id, ...target.slice(index)],
  }
}

function QueuedList({
  column,
  lanes,
}: {
  column: BoardColumn & { lane: string }
  lanes: Record<string, string>
}) {
  // The list itself takes a drop only while it is empty; once it holds cards, its cards do, so a keyboard move left or right lands on the next lane's cards rather than back on the list it started in.
  const { isOver, setNodeRef } = useDroppable({
    disabled: column.cards.length > 0,
    id: column.lane,
  })
  return (
    <SortableContext
      id={column.lane}
      items={column.cards.map((card) => card.id)}
      strategy={verticalListSortingStrategy}
    >
      <ul
        ref={setNodeRef}
        aria-label={column.title}
        className={cn(
          "bg-muted/50 flex min-h-12 flex-col gap-1.5 rounded-lg p-1.5",
          isOver && "bg-muted",
        )}
      >
        {column.cards.map((card) => (
          <SortableCard key={card.id} card={card} column={column.lane} lanes={lanes} />
        ))}
      </ul>
    </SortableContext>
  )
}

function FixedList({ column, lanes }: { column: BoardColumn; lanes: Record<string, string> }) {
  return (
    <ul
      aria-label={column.title}
      className="bg-muted/50 flex min-h-12 flex-col gap-1.5 rounded-lg p-1.5"
    >
      {column.cards.map((card) => (
        <FixedCard key={card.id} card={card} lanes={lanes} />
      ))}
    </ul>
  )
}

// The Plan page's board: a Queued column per lane, which the owner drags to set what is built first, then In flight, In review and Done today, which move by themselves. A drop shows at once, is saved to order.json (the planner keeps it pinned on every re-groom), and offers Undo in its toast.
export function PlanBoard({ order, plan }: { order: OrderLanes | null; plan: Plan }) {
  const queryClient = useQueryClient()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // dnd-kit's default also drops on Tab; leaving a card by Tab should not save a move.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { cancel: ["Escape"], end: ["Space", "Enter"], start: ["Space", "Enter"] },
    }),
  )
  const [drag, setDrag] = useState<{ before: OrderLanes; id: string; ids: OrderLanes } | null>(null)
  const [shown, setShown] = useState<OrderLanes | null>(null)
  const saved = useMemo(() => queuedIds(plan, order), [plan, order])
  const ids = drag?.ids ?? shown ?? saved
  // The lanes as the drag handlers last left them: dnd-kit words its announcements before React renders the move.
  const live = useRef<OrderLanes>(ids)
  const columns = boardColumns(plan, ids)
  const lanes = Object.fromEntries(plan.lanes.map((lane) => [lane.id, lane.title]))
  const cards = new Map<string, BoardCard>(
    columns.flatMap((column) => column.cards.map((card) => [card.id, card] as const)),
  )

  const writing = useRef(0)
  // One move's toast at a time: an older toast's Undo would put back an order a later drop has changed.
  const lastToast = useRef<string | null>(null)
  const notify = (options: Parameters<typeof toast.add>[0]) => {
    if (lastToast.current) toast.close(lastToast.current)
    lastToast.current = toast.add(options)
  }
  // Each write carries what it undoes: a drop offers Undo in its toast, and the undo itself offers nothing more.
  const save = useMutation({
    mutationFn: ({
      lanes: next,
    }: {
      before: OrderLanes | null
      lanes: OrderLanes
      title: string
    }) => saveOrder(next),
    onError: (err) =>
      toast.add({ title: `The order was not saved: ${err.message}`, type: "error" }),
    onMutate: () => {
      writing.current += 1
    },
    // Once every write is in, the board reads the saved order back and shows that.
    onSettled: async () => {
      writing.current -= 1
      if (writing.current > 0) return
      await queryClient.invalidateQueries({ queryKey: PLAN_QUERY_KEY })
      // A drop made while the order was read back keeps showing until its own write is in.
      if (writing.current === 0) setShown(null)
    },
    onSuccess: (_, { before, title }) => {
      if (!before) {
        notify({ title: `Put ${title} back`, type: "success" })
        return
      }
      notify({
        actionProps: {
          children: "Undo",
          onClick: () => {
            setShown(before)
            save.mutate({ before: null, lanes: before, title })
          },
        },
        title: `Moved ${title}`,
        type: "success",
      })
    },
    // One write at a time, in the order they were made.
    scope: { id: "plan-order" },
  })

  const place = (next: OrderLanes, before: OrderLanes, title: string) => {
    setShown(next)
    save.mutate({ before, lanes: next, title })
  }

  const titleOf = (id: UniqueIdentifier) => cards.get(String(id))?.title ?? "the item"
  const where = (id: UniqueIdentifier) => standing(live.current, String(id), lanes)
  const announcements: Announcements = {
    onDragCancel: ({ active }) =>
      `Moving ${titleOf(active.id)} was cancelled; it is back where it was.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} was dropped ${where(active.id)}.`
        : `${titleOf(active.id)} was dropped where it was.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} is ${where(active.id)}.` : undefined,
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)} ${where(active.id)}.`,
  }

  const active = drag ? cards.get(drag.id) : undefined

  return (
    <DndContext
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      sensors={sensors}
      onDragCancel={() => {
        if (drag) live.current = drag.before
        setDrag(null)
      }}
      onDragEnd={({ active: moved, over }) => {
        if (!drag) return
        let final = drag.ids
        const lane = over ? laneOf(final, String(over.id)) : null
        if (over && lane && lane === laneOf(final, String(moved.id))) {
          const from = final[lane]!.indexOf(String(moved.id))
          const to = final[lane]!.indexOf(String(over.id))
          if (to >= 0 && from !== to)
            final = { ...final, [lane]: arrayMove(final[lane]!, from, to) }
        }
        live.current = final
        setDrag(null)
        if (over && !sameOrder(drag.before, final)) place(final, drag.before, titleOf(moved.id))
      }}
      onDragOver={(event) => {
        if (!drag) return
        const next = overLane(drag.ids, event)
        if (!next) return
        live.current = next
        setDrag({ ...drag, ids: next })
      }}
      onDragStart={({ active: picked }) => {
        live.current = ids
        setDrag({ before: ids, id: String(picked.id), ids })
      }}
    >
      <div
        role="region"
        aria-label="Board"
        tabIndex={0}
        className="focus-visible:ring-ring/50 flex gap-3 overflow-x-auto pb-2 outline-none focus-visible:ring-[3px]"
      >
        {columns.map((column) => (
          <section
            key={column.id}
            aria-labelledby={`board-${column.id}`}
            className="flex min-w-40 flex-1 basis-0 flex-col gap-1.5"
          >
            <h2
              id={`board-${column.id}`}
              className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium"
            >
              {column.title}
              {/* a count that changes as cards move: mono, fixed width, right-aligned, so the heading never shifts */}
              <span className="ml-auto w-6 text-right font-mono font-normal tabular-nums">
                {column.cards.length}
              </span>
            </h2>
            {column.lane !== null ? (
              <QueuedList column={{ ...column, lane: column.lane }} lanes={lanes} />
            ) : (
              <FixedList column={column} lanes={lanes} />
            )}
          </section>
        ))}
      </div>
      <DragOverlay>{active ? <OverlayCard card={active} lanes={lanes} /> : null}</DragOverlay>
    </DndContext>
  )
}
