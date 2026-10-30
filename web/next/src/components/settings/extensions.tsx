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
import {
  RiAddLine,
  RiCheckLine,
  RiCloseLine,
  RiDraggable,
  RiLockLine,
  RiMoreLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import * as React from "react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { Hint } from "@/components/hint"
import { SetUpSettings } from "@/components/settings/set-up-settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemGroup } from "@/components/ui/item"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/components/ui/toast"
import { apiClient, unwrap } from "@/lib/api/client"
import { useNow } from "@/lib/dashboard"
import {
  countsLine,
  EXTENSION_NAME,
  EXTENSIONS_QUERY_KEY,
  type ExtensionRow,
  linkWords,
  movedNames,
  ORG,
  REPO,
  whyLines,
} from "@/lib/extensions"
import { relativeTime } from "@/lib/time"

type Rows = ExtensionRow[] | null

// An answer's data, or its error thrown with the API's own words.
const answer = async <R extends { data: unknown; error: { message: string } | null }>(
  call: Promise<R>,
): Promise<NonNullable<R["data"]>> => {
  const { data, error } = await call
  if (error) throw new Error(error.message)
  return data as NonNullable<R["data"]>
}

const readExtensions = async (): Promise<Rows> =>
  (await answer(unwrap(apiClient.v1.extensions.$get()))).extensions

// A write that answers with the list as it now stands, put straight into the page.
function useWrite<A>(write: (input: A) => Promise<{ extensions: Rows }>, done?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: write,
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSuccess: (data) => {
      queryClient.setQueryData(EXTENSIONS_QUERY_KEY, data.extensions)
      if (done) toast.add({ title: done, type: "success" })
    },
  })
}

// A keystroke or press on a card's own control is the control's, never the start of a drag.
const own = { onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation() }

// Settings > Extensions: every extension in the order sessions read them, first wins, each with its links, its items by kind, its last sync and a menu (Sync now, Open on GitHub, Why, Remove); core stays last and locked. Drag a card's handle, or focus it and use Space and the arrows, to move it.
export function Extensions() {
  // rows null is the API's word for no login; a failed read leaves them undefined and says so instead
  const {
    data: rows,
    error,
    isPending,
  } = useQuery({
    queryKey: EXTENSIONS_QUERY_KEY,
    queryFn: readExtensions,
  })
  const [why, setWhy] = React.useState<ExtensionRow | null>(null)
  const [removing, setRemoving] = React.useState<ExtensionRow | null>(null)
  const shown = React.useRef<ExtensionRow | null>(null)
  if (removing) shown.current = removing
  const queryClient = useQueryClient()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { cancel: ["Escape"], end: ["Space"], start: ["Space"] },
    }),
  )

  const order = useWrite((names: string[]) =>
    answer(unwrap(apiClient.v1.extensions.order.$put({ json: { names } }))),
  )
  const remove = useMutation({
    mutationFn: (name: string) =>
      answer(unwrap(apiClient.v1.extensions[":name"].$delete({ param: { name } }))),
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSuccess: (data, name) => {
      setRemoving(null)
      queryClient.setQueryData(EXTENSIONS_QUERY_KEY, data.extensions)
      toast.add({ title: `${name} removed; its folder stays`, type: "success" })
    },
  })

  const movable = rows?.filter((row) => row.name !== "core") ?? []
  const core = rows?.find((row) => row.name === "core")
  return (
    <section aria-labelledby="settings-extensions" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="settings-extensions" className="text-muted-foreground text-sm font-medium">
          Extensions
        </h2>
        {rows && <AddExtensionDialog />}
      </div>
      {isPending ? (
        <div aria-busy="true" className="h-14" />
      ) : rows ? (
        <>
          <p className="text-muted-foreground text-xs">
            First wins when two have the same skill. Drag a card by its handle to reorder.
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id) return
              const names = movedNames(rows, String(active.id), String(over.id))
              queryClient.setQueryData<Rows>(EXTENSIONS_QUERY_KEY, [
                ...names.flatMap((name) => movable.filter((row) => row.name === name)),
                ...(core ? [core] : []),
              ])
              order.mutate(names, {
                onError: () => queryClient.setQueryData(EXTENSIONS_QUERY_KEY, rows),
              })
            }}
          >
            <SortableContext
              items={movable.map((row) => row.name)}
              strategy={verticalListSortingStrategy}
            >
              <ItemGroup className="gap-2">
                {movable.map((row, at) => (
                  <ExtensionCard
                    key={row.name}
                    place={at + 1}
                    row={row}
                    onRemove={() => setRemoving(row)}
                    onWhy={() => setWhy(row)}
                  />
                ))}
                {core && <CoreCard place={rows.length} row={core} />}
              </ItemGroup>
            </SortableContext>
          </DndContext>
          <WhyDialog key={why?.name} rows={rows} row={why} onClose={() => setWhy(null)} />
        </>
      ) : rows === null ? (
        <SetUpSettings />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Extensions could not be read</EmptyTitle>
            <EmptyDescription>{error?.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${shown.current?.name ?? ""}?`}
        description="No session reads it once it leaves the order, links and repos. Its folder stays on this Mac, and Add brings it back."
        action="Remove"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.name)
        }}
      />
    </section>
  )
}

function ExtensionCard({
  onRemove,
  onWhy,
  place,
  row,
}: {
  onRemove: () => void
  onWhy: () => void
  place: number
  row: ExtensionRow
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    attributes: { role: "button" },
    id: row.name,
  })
  const sync = useMutation({
    mutationFn: () =>
      answer(unwrap(apiClient.v1.extensions[":name"].sync.$post({ param: { name: row.name } }))),
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSuccess: () => toast.add({ title: `${row.name} synced`, type: "success" }),
  })
  return (
    <Item
      ref={setNodeRef}
      role="listitem"
      size="sm"
      variant="outline"
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("items-start", isDragging && "opacity-40")}
    >
      <Hint content={`Move ${row.name}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${row.name}`}
          className="cursor-grab"
          {...attributes}
          {...listeners}
        >
          <RiDraggable />
        </Button>
      </Hint>
      <ExtensionBody place={place} row={row}>
        <Links row={row} />
      </ExtensionBody>
      <ItemActions>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`${row.name}'s menu`} />}
          >
            <RiMoreLine />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={sync.isPending} onClick={() => sync.mutate()}>
                Sync now
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <a href={`https://github.com/${row.repo}`} rel="noreferrer" target="_blank" />
                }
              >
                Open on GitHub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onWhy}>Why…</DropdownMenuItem>
              {!row.login && (
                <DropdownMenuItem variant="destructive" onClick={onRemove}>
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  )
}

function CoreCard({ place, row }: { place: number; row: ExtensionRow }) {
  return (
    <Item role="listitem" size="sm" variant="outline" className="items-start">
      <Hint content="Core stays last">
        <span className="text-muted-foreground flex size-8 items-center justify-center">
          <RiLockLine className="size-4" />
        </span>
      </Hint>
      <ExtensionBody place={place} row={row} repo="built into Playground">
        <span className="text-muted-foreground">Linked to everywhere</span>
      </ExtensionBody>
      <span aria-hidden className="size-8" />
    </Item>
  )
}

// A card's words: its place and name with its repo at the right, its links, then its items by kind and its last sync.
function ExtensionBody({
  children,
  place,
  repo,
  row,
}: {
  children: React.ReactNode
  place: number
  repo?: string
  row: ExtensionRow
}) {
  const now = useNow()
  return (
    <ItemContent className="min-w-0 gap-1.5 py-1 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">
          <span className="text-muted-foreground mr-2 tabular-nums">{place}</span>
          {row.name}
        </span>
        <span className="text-muted-foreground truncate">{repo ?? row.repo}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="text-muted-foreground flex justify-between gap-2">
        <span>{countsLine(row.counts)}</span>
        {row.syncedAt && <span>synced {relativeTime(row.syncedAt, new Date(now))}</span>}
      </div>
    </ItemContent>
  )
}

// Linked to: a chip for each org, or everywhere, each with its ✕ but the login's, and + org to link one more.
function Links({ row }: { row: ExtensionRow }) {
  const link = useWrite((org: string) =>
    answer(
      unwrap(
        apiClient.v1.extensions[":name"].links.$post({
          json: { org },
          param: { name: row.name },
        }),
      ),
    ),
  )
  const unlink = useWrite((org: string) =>
    answer(
      unwrap(
        apiClient.v1.extensions[":name"].links[":org"].$delete({
          param: { name: row.name, org },
        }),
      ),
    ),
  )
  return (
    <>
      <span className="text-muted-foreground">Linked to</span>
      {row.links.length === 0 && <span className="text-muted-foreground">no org yet</span>}
      {row.links.map((org) => (
        <Badge key={org} variant="outline">
          {linkWords(org)}
          {!row.login && (
            <button
              type="button"
              aria-label={`Unlink ${row.name} from ${linkWords(org)}`}
              className="text-muted-foreground hover:text-foreground -mr-1 rounded-sm"
              disabled={unlink.isPending}
              onClick={() => unlink.mutate(org)}
              {...own}
            >
              <RiCloseLine className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {!row.login && <AddOrg onAdd={(org) => link.mutateAsync(org)} pending={link.isPending} />}
    </>
  )
}

// + org: a GitHub org to link, or * for every repo.
function AddOrg({
  onAdd,
  pending,
}: {
  onAdd: (org: string) => Promise<unknown>
  pending: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [org, setOrg] = React.useState("")
  const valid = ORG.test(org.trim())
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setOrg("")
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="xs" {...own} />}>
        <RiAddLine />
        org
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            // the Add dialog's own form sits around this one through the portal, and must not submit with it
            event.stopPropagation()
            if (valid)
              onAdd(org.trim()).then(
                () => setOpen(false),
                () => {},
              )
          }}
        >
          <Input
            autoFocus
            aria-label="GitHub org, or * for everywhere"
            placeholder="org, or * for everywhere"
            value={org}
            onChange={(event) => setOrg(event.target.value)}
            className="text-xs"
          />
          <Button type="submit" size="sm" disabled={!valid || pending}>
            Link
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

// Why: which extension a session in a repo of the org takes a skill from, and the copies it hides.
function WhyDialog({
  onClose,
  row,
  rows,
}: {
  onClose: () => void
  row: ExtensionRow | null
  rows: ExtensionRow[]
}) {
  const [skill, setSkill] = React.useState("")
  const [org, setOrg] = React.useState(row?.links.find((link) => link !== "*") ?? "")
  const asked = useMutation({
    mutationFn: (query: { org?: string; skill: string }) =>
      answer(unwrap(apiClient.v1.extensions.why.$get({ query }))),
  })
  const lines = asked.data ? whyLines(rows, asked.data) : null
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (skill.trim())
                asked.mutate({ skill: skill.trim(), ...(org.trim() ? { org: org.trim() } : {}) })
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>Why…</DialogTitle>
          <DialogDescription>
            Which copy of a skill a session loads, and which it hides.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="why-skill">Skill</FieldLabel>
            <Input
              id="why-skill"
              autoComplete="off"
              placeholder="end-of-day"
              value={skill}
              onChange={(event) => setSkill(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="why-org">In a repo of</FieldLabel>
            <Input
              id="why-org"
              autoComplete="off"
              placeholder="an org, or blank for every repo"
              value={org}
              onChange={(event) => setOrg(event.target.value)}
            />
          </Field>
          {asked.error && <FieldError>{asked.error.message}</FieldError>}
          {lines && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">loads from</dt>
              <dd>{lines.from}</dd>
              {lines.hides && (
                <>
                  <dt className="text-muted-foreground">hides</dt>
                  <dd>{lines.hides}</dd>
                </>
              )}
              {lines.core && <dd className="text-muted-foreground col-span-2">{lines.core}</dd>}
            </dl>
          )}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Close</DialogClose>
          <Button type="submit" disabled={!skill.trim() || asked.isPending}>
            Check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// + Add extension: a name, a repo or none (the login's playground-<name>), and its links; a repo not there yet is named in a confirm before it is made, private.
function AddExtensionDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [repo, setRepo] = React.useState("")
  const [links, setLinks] = React.useState<string[]>([])
  const [refused, setRefused] = React.useState<string | null>(null)
  const [create, setCreate] = React.useState<string | null>(null)
  const reset = () => {
    setName("")
    setRepo("")
    setLinks([])
    setRefused(null)
    setCreate(null)
  }
  const add = useMutation({
    mutationFn: async (yes: boolean) => {
      const added = await answer(
        unwrap(
          apiClient.v1.extensions.$post({
            json: { name, ...(repo.trim() ? { repo: repo.trim() } : {}), yes },
          }),
        ),
      )
      if ("create" in added) return added
      for (const org of links)
        await answer(
          unwrap(apiClient.v1.extensions[":name"].links.$post({ json: { org }, param: { name } })),
        )
      return added
    },
    onError: (error) => {
      setCreate(null)
      setRefused(error.message)
    },
    onSuccess: (added) => {
      if ("create" in added && added.create) return setCreate(added.create)
      setOpen(false)
      toast.add({ title: `${name} added`, type: "success" })
      reset()
      queryClient.invalidateQueries({ queryKey: EXTENSIONS_QUERY_KEY })
    },
  })
  const nameValid = EXTENSION_NAME.test(name)
  const repoValid = !repo.trim() || REPO.test(repo.trim())
  const asked = useSettled(
    open && nameValid && repoValid ? { name, ...(repo.trim() ? { repo: repo.trim() } : {}) } : null,
  )
  const check = useQuery({
    enabled: asked !== null,
    queryFn: () => answer(unwrap(apiClient.v1.extensions.check.$get({ query: asked! }))),
    queryKey: [...EXTENSIONS_QUERY_KEY, "check", asked?.name, asked?.repo],
    retry: false,
    staleTime: 60_000,
  })
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogTrigger render={<Button variant="outline" size="sm" />}>
          <RiAddLine />
          Add extension
        </DialogTrigger>
        <DialogContent
          render={
            <form
              onSubmit={(event) => {
                event.preventDefault()
                setRefused(null)
                if (!nameValid || !repoValid) return
                // a repo the check found missing is named in the confirm before anything runs
                const current = asked?.name === name && (asked.repo ?? "") === repo.trim()
                if (current && check.data && !check.data.exists) setCreate(check.data.repo)
                else add.mutate(false)
              }}
            />
          }
        >
          <DialogHeader>
            <DialogTitle>Add an extension</DialogTitle>
            <DialogDescription>
              Skills, rules and lists from a private repo, read after the ones above it.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={name !== "" && !nameValid}>
              <FieldLabel htmlFor="extension-name">Name</FieldLabel>
              <Input
                id="extension-name"
                autoComplete="off"
                placeholder="teammate-tests"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={name !== "" && !nameValid}
                disabled={add.isPending}
              />
              <FieldDescription>a-z, 0-9 and -</FieldDescription>
            </Field>
            <Field data-invalid={!repoValid}>
              <FieldLabel htmlFor="extension-repo">Repo</FieldLabel>
              <Input
                id="extension-repo"
                autoComplete="off"
                placeholder="owner/name"
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                aria-invalid={!repoValid}
                disabled={add.isPending}
              />
              <FieldDescription>
                Blank makes your login's playground-{name || "<name>"}, private.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Link</FieldLabel>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {links.map((org) => (
                  <Badge key={org} variant="outline">
                    {linkWords(org)}
                    <button
                      type="button"
                      aria-label={`Drop ${linkWords(org)}`}
                      className="text-muted-foreground hover:text-foreground -mr-1 rounded-sm"
                      onClick={() => setLinks(links.filter((each) => each !== org))}
                    >
                      <RiCloseLine className="size-3" />
                    </button>
                  </Badge>
                ))}
                {!links.includes("*") && (
                  <>
                    <AddOrg
                      pending={false}
                      onAdd={async (org) => {
                        const link = org.toLowerCase()
                        setLinks((had) => (had.includes(link) ? had : [...had, link].sort()))
                      }}
                    />
                    <span className="text-muted-foreground">or</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setLinks(["*"])}
                    >
                      everywhere
                    </Button>
                  </>
                )}
              </div>
            </Field>
            {asked && <CheckLine check={check} />}
            {refused && <FieldError>{refused}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!nameValid || !repoValid || add.isPending}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={create !== null}
        onOpenChange={(next) => {
          if (!next) setCreate(null)
        }}
        title={`Create ${create ?? ""}?`}
        description="It is not on GitHub yet. Playground makes it as a private repo, then adds it here."
        action="Create"
        pending={add.isPending}
        onConfirm={() => add.mutate(true)}
      />
    </>
  )
}

// A value once it has held still for a moment, so a check runs once typing stops rather than on every key.
function useSettled<T>(value: T, ms = 600): T {
  const [settled, setSettled] = React.useState(value)
  const key = JSON.stringify(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(JSON.parse(key) as T), ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return settled
}

// What Add will find on GitHub: a private repo and its skills/, or the repo it will create.
function CheckLine({
  check,
}: {
  check: {
    data?: { exists: boolean; repo: string; skills: number }
    error: Error | null
    isPending: boolean
  }
}) {
  if (check.error) return <FieldError>{check.error.message}</FieldError>
  if (check.isPending || !check.data)
    return <p className="text-muted-foreground text-xs">Checking GitHub…</p>
  const found = check.data
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {found.exists ? (
        <>
          <span className="flex items-center gap-1">
            <RiCheckLine className="size-3" />
            repo is private
          </span>
          <span className="flex items-center gap-1">
            {found.skills ? <RiCheckLine className="size-3" /> : null}
            {found.skills ? `has skills/ (${found.skills})` : "no skills/ yet"}
          </span>
        </>
      ) : (
        <span>{found.repo} will be created (private)</span>
      )}
    </p>
  )
}
