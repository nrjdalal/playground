"use client"

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "cn"

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import {
  type AppPrefs,
  arrangeApps,
  type DashboardApp,
  type DashboardAppId,
  moveApp,
  toggleApp,
} from "@/lib/apps"

type ManagedApp = Pick<DashboardApp, "description" | "icon" | "id" | "title">

// A keystroke on the switch is its own, never the start of a keyboard move (the Plan board's cards do the same for their links).
const own = (event: React.KeyboardEvent) => event.stopPropagation()

function AppRow({
  app,
  hidden,
  onToggle,
}: {
  app: ManagedApp
  hidden: boolean
  onToggle: () => void
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    attributes: { role: "listitem" },
    id: app.id,
  })
  return (
    <Item
      ref={setNodeRef}
      size="sm"
      variant="outline"
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "focus-visible:ring-ring/50 cursor-grab outline-none focus-visible:ring-[3px]",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <ItemMedia variant="icon">
        <app.icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{app.title}</ItemTitle>
        <ItemDescription>{app.description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={`Show ${app.title}`}
          checked={!hidden}
          onCheckedChange={onToggle}
          onKeyDown={own}
          onPointerDown={(event) => event.stopPropagation()}
        />
      </ItemActions>
    </Item>
  )
}

// The aside's Apps tab (#i787): every app in your order, each with a switch that shows or hides its square in the tab bar, and dragged by the pointer, or with Space, the arrows and Space on a focused row, into the order the squares take. A change is its own confirmation, kept in this browser (lib/apps.ts).
export function AppManager({
  apps,
  onChange,
  prefs,
}: {
  apps: ManagedApp[]
  onChange: (prefs: AppPrefs) => void
  prefs: AppPrefs
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { cancel: ["Escape"], end: ["Space"], start: ["Space"] },
    }),
  )
  const listed = arrangeApps(apps, prefs)
  const ids = listed.map((app) => app.id)
  return (
    <section aria-labelledby="apps" className="flex flex-col gap-3">
      <div className="space-y-1">
        <h2 id="apps" className="text-sm font-medium">
          Apps
        </h2>
        <p className="text-muted-foreground text-sm">
          Show an app's square in the tab bar, or drag it into place. Kept in this browser.
        </p>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return
          const from = ids.indexOf(active.id as DashboardAppId)
          onChange(moveApp(prefs, ids, from, ids.indexOf(over.id as DashboardAppId)))
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ItemGroup className="gap-2">
            {listed.map((app) => (
              <AppRow
                key={app.id}
                app={app}
                hidden={prefs.hidden.includes(app.id)}
                onToggle={() => onChange(toggleApp(prefs, app.id))}
              />
            ))}
          </ItemGroup>
        </SortableContext>
      </DndContext>
    </section>
  )
}
