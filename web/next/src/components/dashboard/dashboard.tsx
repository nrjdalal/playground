"use client"

import type { Worker } from "@api/hono"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { usePathname } from "next/navigation"
import { useQueryState } from "nuqs"
import { createContext, use, useEffect, useMemo, useRef, useState } from "react"

import { toast } from "@/components/ui/toast"
import { agentLabel } from "@/lib/agent-label"
import {
  AGENTS_QUERY_KEY,
  liveAgents,
  orderByStatus,
  resetManagersOrder,
  saveManagersOrder,
  useAgents,
} from "@/lib/agents"
import { useBuildReload } from "@/lib/build-reload"
import { useDashboardChats, type DashboardChats, type Outbox } from "@/lib/chat"
import {
  dispatcherOf,
  pickWorker,
  useHeldLights,
  useDashboardSocket,
  useEntries,
  type DashboardProblem,
  type EntriesListener,
  type Older,
  type OtherView,
} from "@/lib/dashboard"
import { inboxPosters, useInbox } from "@/lib/inbox"
import type { Activity } from "@/lib/live-activity"
import { waitingSessions } from "@/lib/needs-you"

// One stream the dashboard reads: its session's spinner line, sent while its chat is open and it works (null when it shows none), whether its steps are loading, its older steps, and why its steps could not be read, which its stream says where its steps would be.
export type DashboardStream = {
  activity: Activity | null
  loading: boolean
  older: Older
  problem: DashboardProblem | null
}

export type DashboardContext = {
  allowed: boolean
  // Playground's own session while the page shows another, whose chat the aside window's Chat tab holds; null on your chat, where the page is his.
  asideChat: Worker | null
  // Every agent with its pull request, ticket and status, read once here so the sidebar's rows and the dashboard's table agree.
  board: Pick<ReturnType<typeof useAgents>, "agents" | "data" | "error" | "isPending" | "refetch">
  // One chat per session, the one store of its stream: the selected session's transcript and every message sent from here.
  chats: DashboardChats
  // Whether a session's permission and plan prompts may be answered here; off until the dashboard's login is the owner's alone.
  approvals: boolean
  connected: boolean
  // The primary dispatcher's name as the API gives it, whose chat is the dashboard's home; null until the socket's first board.
  dispatcher: string | null
  // Every name the dispatcher role goes to, the primary first, as the API gives them; null until the socket's first board.
  dispatchers: readonly string[] | null
  // The socket's own problem, the read's error frame, which the System item's light shows as lost; problem adds the selected stream's.
  feedProblem: DashboardProblem | null
  // Each live session's light once it has held (useHeldLights), which its icon shows; a session not yet settled shows its own.
  held: ReadonlyMap<string, Worker["light"]>
  other: OtherView
  // The Orchestrators rows' order: the dragged order shown at once, then as the API keeps it; move saves a new one, reset forgets it so A to Z by title returns.
  managers: { move: (names: string[]) => void; order: readonly string[]; reset: () => void }
  // Whether the Scripts group is open, collapsed by default; kept here as Other's toggles are.
  scripts: { open: boolean; setOpen: (open: boolean) => void }
  // Which session rows are opened to their reviewers, testers, subagents and processes.
  open: { has: (sessionId: string) => boolean; toggle: (sessionId: string) => void }
  outbox: Outbox
  problem: DashboardProblem | null
  selected: Worker | null
  // Each stream read now, by its session: Playground's, and the selected session's when it is another.
  streams: ReadonlyMap<string, DashboardStream>
  subscribe: (listener: EntriesListener) => () => void
  // The sessions with anything waiting on you: a picker, or an open inbox item they posted.
  waiting: ReadonlySet<string>
  workers: Worker[] | null
}

// No dragged order: one array, so the ordered board is not worked out again on every render.
const NO_ORDER: readonly string[] = []

// Exported for the tests that render a view inside a dashboard of its own.
export const DashboardContext = createContext<DashboardContext | null>(null)

// One live dashboard for the whole dashboard, opened only for the owner rung the API demands (a socket the API refuses would only say reconnecting), so the sidebar's worker list and the page's stream share a socket and a selection. The selected worker is the URL's ?worker=, so a link opens straight to it. Only /dashboard selects one: the one ?worker= names, else the dispatcher, whose chat is the dashboard's home; on another page no worker row is current. Beside any page but your chat, the aside window holds Playground's chat, so his transcript is read there too.
export function DashboardProvider({
  allowed,
  children,
}: {
  allowed: boolean
  children: React.ReactNode
}) {
  const socket = useDashboardSocket(allowed)
  const { approvals, connected, dispatcher, dispatchers, generation, problem, subscribe, watch } =
    socket
  // The one poller of the inbox, here because the provider is always mounted (on a narrow screen the sidebar unmounts while it is closed); every surface that shows it reads its cache.
  const items = useInbox(allowed, { poll: true }).data?.items
  // a session waiting on an inbox item it posted waits on you as surely as one at a picker, so its row ranks with them
  const waiting = useMemo(
    () => waitingSessions(socket.workers, inboxPosters(items ?? [])),
    [items, socket.workers],
  )
  const held = useHeldLights(socket.workers)
  const read = useAgents(subscribe, socket.workers, allowed)
  // Every view reads the board in one order, by the state each row's icon draws, so the sidebar and the dashboard's table move together.
  const queryClient = useQueryClient()
  // a drop shows at once and stays until every write is in and the board reads it back; a refused one rolls back with a toast
  const [shownOrder, setShownOrder] = useState<readonly string[] | null>(null)
  const writing = useRef(0)
  const saveOrder = useMutation({
    mutationFn: (names: string[] | null) =>
      names ? saveManagersOrder(names) : resetManagersOrder(),
    onError: (err) =>
      toast.add({ title: `The managers' order was not saved: ${err.message}`, type: "error" }),
    onMutate: (names) => {
      writing.current += 1
      setShownOrder(names ?? [])
    },
    onSettled: async () => {
      writing.current -= 1
      if (writing.current > 0) return
      await queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
      if (writing.current === 0) setShownOrder(null)
    },
  })
  const managersOrder = shownOrder ?? read.data?.managersOrder ?? NO_ORDER
  const workers = useMemo(
    () =>
      socket.workers &&
      orderByStatus(
        socket.workers,
        read.data?.agents ?? null,
        held,
        waiting,
        Date.now(),
        managersOrder,
        dispatchers ?? NO_ORDER,
      ),
    [dispatchers, held, managersOrder, read.data, socket.workers, waiting],
  )
  // the fields the views read, so the board stays one object while none of them changes (useAgents returns a new one each render)
  const { data: agentsData, error: agentsError, isPending: agentsPending, refetch } = read
  const board = useMemo(
    () => ({
      agents: agentsData ? liveAgents(agentsData.agents, workers) : null,
      data: agentsData,
      error: agentsError,
      isPending: agentsPending,
      refetch,
    }),
    [agentsData, agentsError, agentsPending, refetch, workers],
  )
  const [requested] = useQueryState("worker")
  const onDashboard = usePathname() === "/dashboard"
  const selectedId = onDashboard ? pickWorker(requested, workers, dispatcher) : null
  const selected = workers?.find((w) => w.sessionId === selectedId) ?? null
  // Playground's transcript is read on every page, as your chat or beside the page, so moving between pages never reads it again; another session's only while it is selected
  const primary = allowed ? dispatcherOf(workers, dispatcher) : null
  const primaryId = primary?.sessionId ?? null
  const otherId = selectedId === primaryId ? null : selectedId
  const own = useEntries(primaryId, subscribe, generation)
  const picked = useEntries(otherId, subscribe, generation)
  const asideChat = selectedId !== primaryId ? primary : null
  // the socket sends one chat's spinner line: the page's, else the aside's
  const watched = selectedId ?? primaryId
  useEffect(() => {
    watch(watched)
  }, [watched, watch])
  const { chats, outbox } = useDashboardChats(
    workers,
    { entries: own.entries, sessionId: primaryId, sessionName: primary?.name ?? null },
    {
      entries: picked.entries,
      sessionId: otherId,
      sessionName: selected?.name ?? null,
    },
    agentLabel,
  )
  // after a roll serves a new build, an open tab reloads onto it once (the production build has no dev socket)
  useBuildReload(outbox.messages)
  // The Other group's two toggles, here for the same reason as the inbox: the group leaves the sidebar with its last session, and the sidebar unmounts on a narrow screen, so state kept there would reset. The sidebar and the dashboard's table share them, as they show the one group.
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherShowIdle, setOtherShowIdle] = useState(false)
  const [scriptsOpen, setScriptsOpen] = useState(false)
  // Each row starts collapsed, and stays as you left it while the dashboard is open, for the same reason.
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set())
  const open = useMemo(
    () => ({
      has: (sessionId: string) => openRows.has(sessionId),
      toggle: (sessionId: string) =>
        setOpenRows((rows) => {
          const next = new Set(rows)
          if (!next.delete(sessionId)) next.add(sessionId)
          return next
        }),
    }),
    [openRows],
  )
  useProblemToast(problem)
  const other = useMemo(
    () => ({
      open: otherOpen,
      setOpen: setOtherOpen,
      setShowIdle: setOtherShowIdle,
      showIdle: otherShowIdle,
    }),
    [otherOpen, otherShowIdle],
  )
  const { mutate: mutateOrder } = saveOrder
  const managers = useMemo(
    () => ({
      move: (names: string[]) => mutateOrder(names),
      order: managersOrder,
      reset: () => mutateOrder(null),
    }),
    [managersOrder, mutateOrder],
  )
  const scripts = useMemo(() => ({ open: scriptsOpen, setOpen: setScriptsOpen }), [scriptsOpen])
  const activity = socket.activity?.sessionId === watched ? socket.activity.activity : null
  // keyed on each read's fields, since useEntries hands back a new object every render
  const { loading: ownLoading, older: ownOlder, problem: ownProblem } = own
  const { loading: pickedLoading, older: pickedOlder, problem: pickedProblem } = picked
  const streams = useMemo(() => {
    const map = new Map<string, DashboardStream>()
    const read = (id: string | null, fields: Omit<DashboardStream, "activity">) => {
      if (id) map.set(id, { activity: id === watched ? activity : null, ...fields })
    }
    read(primaryId, { loading: ownLoading, older: ownOlder, problem: ownProblem })
    read(otherId, { loading: pickedLoading, older: pickedOlder, problem: pickedProblem })
    return map
  }, [
    activity,
    primaryId,
    otherId,
    ownLoading,
    ownOlder,
    ownProblem,
    pickedLoading,
    pickedOlder,
    pickedProblem,
    watched,
  ])
  const selectedProblem = selectedId === primaryId ? ownProblem : pickedProblem
  // One value for as long as nothing in it changes, so a render of the provider alone (a key typed into the composer, an inbox poll that brought nothing new) re-renders none of the views that read it.
  const value = useMemo<DashboardContext>(
    () => ({
      allowed,
      approvals,
      asideChat,
      board,
      chats,
      connected,
      dispatcher,
      dispatchers,
      feedProblem: problem,
      held,
      managers,
      open,
      other,
      outbox,
      problem: problem ?? selectedProblem,
      scripts,
      selected,
      streams,
      subscribe,
      waiting,
      workers,
    }),
    [
      allowed,
      approvals,
      asideChat,
      board,
      chats,
      connected,
      dispatcher,
      dispatchers,
      held,
      managers,
      open,
      other,
      outbox,
      problem,
      scripts,
      selected,
      selectedProblem,
      streams,
      subscribe,
      waiting,
      workers,
    ],
  )

  return <DashboardContext value={value}>{children}</DashboardContext>
}

export function useDashboard(): DashboardContext {
  const dashboard = use(DashboardContext)
  if (!dashboard) throw new Error("useDashboard needs a DashboardProvider")
  return dashboard
}

// Each @Name a session wrote, as the view of the live session it names, by its raw name or else its label, in any case; null outside the dashboard, where no session is live. Kept while the same sessions are live, in any order, so a message is not parsed again on every frame or when the board reorders.
export function useMentions(): ((mention: string) => string | null) | null {
  const workers = use(DashboardContext)?.workers
  const key =
    workers
      ?.map((w) => `${w.sessionId} ${w.name}`)
      .sort()
      .join("\n") ?? ""
  return useMemo(() => {
    if (!key) return null
    const lines = key.split("\n").map((line) => line.split(/ (.*)/))
    const views = new Map<string, string>()
    for (const [sessionId = "", name = ""] of lines) {
      views.set(agentLabel(name).toLowerCase(), sessionView(sessionId))
    }
    for (const [sessionId = "", name = ""] of lines) {
      views.set(name.toLowerCase(), sessionView(sessionId))
    }
    return (mention) => views.get(mention.toLowerCase()) ?? null
  }, [key])
}

const sessionView = (sessionId: string) => `/dashboard?worker=${encodeURIComponent(sessionId)}`

// One toast per outage of the live sessions read (the socket's problem, raised at its second miss), dismissed by itself as any toast is, or closed when a read recovers, so it never covers a phone's tabs for the whole outage, in place of a card on the chat's top edge.
function useProblemToast(problem: DashboardProblem | null) {
  const id = useRef<string | null>(null)
  useEffect(() => {
    if (problem && id.current) toast.update(id.current, { description: problem.message })
    else if (problem)
      id.current = toast.add({
        description: problem.message,
        title: "Live sessions cannot be read",
        type: "error",
      })
    else if (id.current) {
      toast.close(id.current)
      id.current = null
    }
  }, [problem])
  // Leaving the dashboard (the console, signing out) closes it too, so coming back mid-outage shows one toast, not two.
  useEffect(
    () => () => {
      if (id.current) toast.close(id.current)
      id.current = null
    },
    [],
  )
}
