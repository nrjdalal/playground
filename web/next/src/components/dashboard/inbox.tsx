"use client"

import type { InboxAction, InboxItem, InboxPreview, InboxUpdate } from "@api/hono"
import type { DISPATCHER_SLOT_LABELS } from "@packages/config/kinds"
import {
  RiAlarmWarningLine,
  RiArchive2Line,
  RiArrowDownSLine,
  RiArrowUpLine,
  RiChat3Line,
  RiCheckDoubleLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDraftLine,
  RiExternalLinkLine,
  RiGitMergeLine,
  RiInboxLine,
  RiMoneyDollarCircleLine,
  RiProgress4Line,
  RiQuestionAnswerLine,
  RiRefreshLine,
  RiReplyLine,
  RiSearchEyeLine,
  RiSendPlaneLine,
  RiShipLine,
  RiSlackLine,
  RiTableLine,
  RiTicketLine,
  RiWindowLine,
  RiZzzLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"

import { COMPOSER_ID } from "@/components/dashboard/composer"
import { useDashboard } from "@/components/dashboard/dashboard"
import { PreviewPane } from "@/components/dashboard/preview-pane"
import { Attachments } from "@/components/dashboard/viewer/thumbnails"
import { Hint, OFF_FOCUSABLE } from "@/components/hint"
import { OPEN_HEADER, SHELF_ITEM, SHELF_ROW, STICKY_HEADER } from "@/components/shelf"
import { ShelfMark } from "@/components/shelf-mark"
import { TranscriptMarkdown } from "@/components/transcript-markdown"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import { CenterSpinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { agentLabel, roleLabel } from "@/lib/agent-label"
import { apiClient, unwrap } from "@/lib/api/client"
import { useNow } from "@/lib/dashboard"
import {
  answerItem,
  canDraft,
  cardKey,
  type CardKey,
  changedAt,
  dismissable,
  dismissItems,
  focusAfterTake,
  INBOX_QUERY_KEY,
  inboxLight,
  inboxSummary,
  inboxView,
  itemTag,
  kindWord,
  markRead,
  MOVED_PAUSE_MS,
  movedStep,
  newLabel,
  outcomeLine,
  pickedAt,
  pinnedView,
  reopenable,
  reopenKey,
  resultLink,
  retryable,
  retryItem,
  schedulable,
  scheduleChoices,
  scheduleItem,
  sendFailed,
  sendWhy,
  takenBy,
  updatedSince,
  upfrontLink,
  useInbox,
} from "@/lib/inbox"
import { needsYouAnchor, useNeedsYouTarget } from "@/lib/needs-you"
import { setReply, useReply, useTypedReply } from "@/lib/reply"
import { iconTone, type ShownState, statusIcon } from "@/lib/status-icons"
import { inboxMark, readMark } from "@/lib/tab-dot"
import { fullTime, relativeTime } from "@/lib/time"

const DECISION_ICONS: Record<InboxPreview["type"], RemixiconComponentType> = {
  ask: RiQuestionAnswerLine,
  budget: RiMoneyDollarCircleLine,
  delete: RiDeleteBinLine,
  schema: RiTableLine,
  ship: RiShipLine,
  slack: RiSlackLine,
  ticket: RiTicketLine,
}

const OUTCOME_ICONS: Record<InboxUpdate["outcome"], RemixiconComponentType> = {
  alert: RiAlarmWarningLine,
  decision: RiCheckDoubleLine,
  finding: RiSearchEyeLine,
  merged: RiGitMergeLine,
  shipped: RiShipLine,
}

const iconOf = (item: InboxItem): RemixiconComponentType =>
  item.kind === "draft"
    ? kindWord(item) === "Linear comment"
      ? RiChat3Line
      : RiSlackLine
    : item.kind === "update"
      ? OUTCOME_ICONS[item.preview.outcome]
      : DECISION_ICONS[item.preview.type]

// Each kind's colour, on its icon; an alert keeps the red its word asks for.
const KIND_TONES: Record<InboxItem["kind"], string> = {
  decision: "text-warning",
  draft: "text-info",
  update: "text-success",
}

// The column a card's state icon sits in, one box wide and one line tall, so the place line's words and the title's start at the same x and the icon is centred on the title's first line.
const LEAD = "flex h-lh w-4 shrink-0 items-center justify-center"

// A card's state as the sidebar draws the same state, beside its title as a row's light sits beside its name; the spinner turns only where motion is allowed.
function Light({ state }: { state: ShownState }) {
  const spec = statusIcon(state)
  return (
    <spec.Icon
      aria-hidden
      className={cn("size-4", iconTone(state), spec.spins && "motion-safe:animate-spin")}
    />
  )
}

const ALERT_TONE = "text-destructive"

const kindTone = (item: InboxItem): string =>
  item.kind === "update" && item.preview.outcome === "alert" ? ALERT_TONE : KIND_TONES[item.kind]

// Each dispatcher's own colour on its name, so the two read apart at a glance.
const POSTER_TONES: Record<(typeof DISPATCHER_SLOT_LABELS)[number], string> = {
  Alpha: "text-info",
  Bravo: "text-bravo",
}

// A dispatcher's tone by its role, never by a name that merely reads Alpha, so a worker named alpha keeps the text's colour.
const posterTone = (from: string): string | undefined => {
  const role = roleLabel(from)
  return role && role in POSTER_TONES ? POSTER_TONES[role as keyof typeof POSTER_TONES] : undefined
}

// The item's kind as an icon and a word, its id, who posted it, and Updated when it changed since his last look, in one muted band across the pane at the card's start, ending in one time and a tick: the only place an item says what it is.
function KindBand({
  busy,
  item,
  now,
  onRead,
  unread,
  updated,
}: {
  busy: boolean
  item: InboxItem
  now: number
  onRead: () => void
  unread: boolean
  updated: boolean
}) {
  const Icon = iconOf(item)
  const kind = item.kind === "draft" ? `${kindWord(item)} to ${item.preview.to}` : kindWord(item)
  const changed = changedAt(item)
  return (
    // a muted band the pane's full width, its words where they sat, so its icon stays over the title's
    <div className="-mx-(--pane-x) text-xs">
      <p className="bg-muted text-foreground flex flex-wrap items-center gap-x-1.5 px-(--pane-x) py-1">
        {/* in the title's LEAD box, 2px on, so the band's words start where the title's do */}
        <span className={cn(LEAD, "me-0.5")}>
          <Icon className={cn("size-3.5", kindTone(item))} aria-hidden />
        </span>
        <span>{kind}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">{itemTag(item)}</span>
        <span aria-hidden>·</span>
        <Hint content={item.from}>
          <span className={posterTone(item.from)}>{agentLabel(item.from)}</span>
        </Hint>
        {updated && (
          <>
            <span aria-hidden>·</span>
            <span className="text-info">Updated</span>
          </>
        )}
        {/* at the right end one time, the last change, then a tick: one to mark it read, two once read, muted */}
        <span className="ml-auto flex items-center gap-1.5">
          {/* plain text on the default cursor, reading when it was read on hover once it is */}
          <time
            dateTime={changed ?? item.createdAt}
            className="group/time cursor-default select-none"
          >
            <span className={cn(item.readAt && "group-hover/time:hidden")}>
              {`${changed ? "updated" : "posted"} ${relativeTime(changed ?? item.createdAt, new Date(now))}`}
            </span>
            {item.readAt && (
              <span className="hidden group-hover/time:inline">
                {`read ${relativeTime(item.readAt, new Date(now))}`}
              </span>
            )}
          </time>
          {unread ? (
            <Hint content="Mark as read">
              <button
                type="button"
                aria-label="Mark as read"
                className="hover:text-foreground text-muted-foreground focus-visible:ring-ring/50 -m-1 rounded-sm p-1 outline-none focus-visible:ring-2 disabled:opacity-50"
                disabled={busy}
                onClick={onRead}
              >
                <RiCheckLine className="size-3.5" aria-hidden />
              </button>
            </Hint>
          ) : (
            <Hint content={item.readAt ? `Read ${fullTime(item.readAt)}` : "Read"}>
              <RiCheckDoubleLine className="text-muted-foreground size-3.5" aria-label="Read" />
            </Hint>
          )}
        </span>
      </p>
    </div>
  )
}

// Where the item points, its PR, ticket or thread, above its title, or why it has no link.
function Place({ item }: { item: InboxItem }) {
  const place = upfrontLink(item)
  if (!place) return null
  return (
    <div className="text-muted-foreground flex gap-2 text-xs">
      <span className={LEAD} />
      {"href" in place ? (
        <a
          href={place.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground inline-flex min-w-0 items-center gap-1 hover:underline"
        >
          {place.label}
          <RiExternalLinkLine className="size-3" aria-hidden />
        </a>
      ) : (
        <span className="min-w-0">No link: {place.reason}</span>
      )}
    </div>
  )
}

// The words a session wrote, as they were written: every line break kept and nothing rendered, so what is approved is what was read, a rule at its left rather than a background marking it as quoted.
const QUOTE = "text-foreground border-l-2 pl-3 break-words whitespace-pre-wrap"

// An ask's words render as a chat message's do, line breaks kept, so a fenced block shows highlighted with its copy button; a Slack message's stay QUOTE, since they are sent exactly as written. Its lines are roomy, on the card's own background.
const ASK_QUOTE =
  "text-foreground min-w-0 break-words leading-relaxed [&_[data-slot=alert-description]]:text-xs [&_[data-slot=alert]]:text-xs [&_[data-streamdown=inline-code]]:text-xs [&_table]:text-xs"

// The card's own boxes (a note, a reply) write small, under the ask they answer; md: beats Textarea's own md:text-sm
const BOX = "text-xs md:text-xs"

// The two labelled options of an ask whose poster labelled both: pick the side whose words he reads, then Send, so the answer is the option he chose.
type Side = "approve" | "deny"
type Labels = Record<Side, string>
const SIDE_WORDS: Labels = { approve: "Approve", deny: "Deny" }

// Approve reads green and Deny red, on a muted wash that deepens when picked, the same on a choice and on a footer button, dark theme included, where the outline Button's own border and hover would win.
const SIDE_TONES: Labels = {
  approve:
    "border-success/30 bg-success/10 hover:bg-success/15 dark:border-success/30 dark:bg-success/10 dark:hover:bg-success/15 data-checked:border-success data-checked:bg-success/20 dark:data-checked:bg-success/20",
  deny: "border-destructive/30 bg-destructive/10 hover:bg-destructive/15 dark:border-destructive/30 dark:bg-destructive/10 dark:hover:bg-destructive/15 data-checked:border-destructive data-checked:bg-destructive/20 dark:data-checked:bg-destructive/20",
}

// Draft saves without sending, so it takes amber between Send's green and Discard's red.
const DRAFT_TONE =
  "border-warning/30 bg-warning/10 hover:bg-warning/15 dark:border-warning/30 dark:bg-warning/10 dark:hover:bg-warning/15"

const labelsOf = (item: InboxItem): Labels | null =>
  item.kind === "decision" &&
  item.preview.type === "ask" &&
  item.preview.approve &&
  item.preview.deny
    ? { approve: item.preview.approve, deny: item.preview.deny }
    : null

// The two options as the card's choices, numbered for the keys 1 and 2. While the card is busy (its answer on its way, or it has just moved under him) they stay enabled, dimmed and busy, and take no click or key: Questionnaire counts a disabled choice as no answer, so disabling them would mark a card Send already checked invalid.
export function AskChoices({
  busy,
  labels,
  paused,
  pick,
  setPick,
}: {
  busy: boolean
  labels: Labels
  paused: boolean
  pick: Side | null
  setPick: (pick: Side) => void
}) {
  return (
    <QuestionnaireChoices
      aria-busy={busy || undefined}
      className={cn(busy && "pointer-events-none opacity-50")}
    >
      {(["approve", "deny"] as const).map((side) => (
        <Hint key={side} content={paused ? PAUSED_WHY : undefined}>
          <QuestionnaireChoice
            checked={pick === side}
            // keys 1 and 2 still pick a side, with no number badge drawn
            className={cn(
              "text-xs [&_[data-slot=questionnaire-choice-shortcut]]:hidden!",
              SIDE_TONES[side],
            )}
            value={SIDE_WORDS[side]}
            onChange={() => {
              if (!busy) setPick(side)
            }}
          >
            <span className="font-medium">{SIDE_WORDS[side]}</span>
            <QuestionnaireChoiceDescription>{labels[side]}</QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
        </Hint>
      ))}
    </QuestionnaireChoices>
  )
}

// What the other side has said so far, one gist line per message with who said it, above the reply it leads to; each gist renders as transcript text until its renderer lands5's renderer lands.
function SoFar({ thread }: { thread?: { said: string; who: string }[] }) {
  if (!thread) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs font-medium">So far</p>
      <ul className="text-muted-foreground flex flex-col gap-1">
        {thread.map((line, index) => (
          <li key={index} className="flex min-w-0 gap-1">
            <span className="shrink-0 font-medium">{line.who}:</span>
            <div className="min-w-0 break-words">
              <TranscriptMarkdown card>{line.said}</TranscriptMarkdown>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// An ask's words and files, and a read-only update's, which shows them with no Approve.
function Shown({ preview }: { preview: Pick<InboxUpdate, "attachments" | "text"> }) {
  return (
    <>
      {preview.text && (
        <div className={ASK_QUOTE}>
          <TranscriptMarkdown card>{preview.text}</TranscriptMarkdown>
        </div>
      )}
      {preview.attachments ? <Attachments items={preview.attachments} /> : null}
    </>
  )
}

// Exactly what Approve does, the card's description: our own words around the session's, a Slack message's plain text that hides nothing and an ask's rendered as its chat would show them.
function Preview({ item }: { item: Extract<InboxItem, { kind: "decision" }> }) {
  const preview = item.preview
  switch (preview.type) {
    case "ask":
      // a labelled ask's choices say what each side does, so its text stands alone above them
      return (
        <>
          {!labelsOf(item) && <p>On Approve, {agentLabel(item.from)} does this:</p>}
          <Shown preview={preview} />
        </>
      )
    case "slack":
      return (
        <>
          <SoFar thread={preview.thread} />
          <p>On Approve, {preview.to} gets:</p>
          <p className={QUOTE}>{preview.text}</p>
        </>
      )
    case "ship":
      return (
        <>
          <p>
            On Approve, main moves to <code className="font-mono">{preview.sha.slice(0, 7)}</code>{" "}
            and the installed skills update. {preview.prs.length} pull request
            {preview.prs.length === 1 ? "" : "s"}:
          </p>
          <ul className="text-foreground list-disc pl-5">
            {preview.prs.map((pr) => (
              <li key={pr.number}>
                #{pr.number} {pr.title}
              </li>
            ))}
          </ul>
        </>
      )
    case "ticket":
      return (
        <>
          <p>
            On Approve, a new ticket is filed in {preview.team}: {preview.title}
          </p>
          <div className={ASK_QUOTE}>
            <TranscriptMarkdown card on="muted">
              {preview.body}
            </TranscriptMarkdown>
          </div>
        </>
      )
    case "delete":
      return (
        <>
          <p>On Approve, this is deleted:</p>
          <p className={QUOTE}>{preview.what}</p>
          <p className="break-words whitespace-pre-wrap">Why: {preview.why}</p>
        </>
      )
    case "schema":
      return (
        <>
          <p>On Approve, this schema is applied:</p>
          <div className={ASK_QUOTE}>
            <TranscriptMarkdown card on="muted">
              {preview.shape}
            </TranscriptMarkdown>
          </div>
        </>
      )
    case "budget":
      return (
        <>
          <p>On Approve, {preview.amount} is spent.</p>
          <p className="break-words whitespace-pre-wrap">Why: {preview.why}</p>
        </>
      )
  }
}

const PAUSED_WHY = "This item just moved: its buttons wake in a moment"

// Pick a time's field starts at 09:00, the hour the fixed choices use.
const PICKED_TIME = "09:00"

// The one question each card's Questionnaire holds, shown from the first render.
const QUESTION = "item"

type Answer = (action: InboxAction, text?: string) => Promise<void>

// Opens Playground's chat replying to this item: the composer's chip names it, and the message carries its id, so the owner can talk about an item with the dispatcher as with a reply.
function ChatAbout({ item }: { item: InboxItem }) {
  return (
    <Hint content="Chat about it">
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={`Chat about ${itemTag(item)}`}
        className="ml-auto shrink-0"
        onClick={() => {
          // rendered at once, so the aside shows Playground's chat before the focus below
          flushSync(() => setReply({ ref: item.ref, title: item.title }))
          // in the click's own frame, so a paste sent at once (a dictation app's Cmd+V) lands in the box
          document.getElementById(COMPOSER_ID)?.focus()
        }}
      >
        <RiReplyLine />
      </Button>
    </Hint>
  )
}

// Opens a card a chat reply collapsed back to its full self, its answers and Schedule back, or folds it again (a dashboard user: "Maybe add a simple shortcut to be able to re-expand it, just like it automatically compacts"); E does the same with focus in the card, as its tooltip says, the scroll bar's Kbd pattern.
function Reopen({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const label = open ? "Hide actions" : "Show actions"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={label}
            aria-expanded={open}
            aria-keyshortcuts="E"
            onClick={() => setOpen(!open)}
          >
            <RiArrowDownSLine
              className={cn("motion-safe:transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2">
        {label}
        <Kbd>E</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

// Snooze (put an ask away until a time, and it asks again then, which is not a schedule), an icon beside Reply: the fixed times, each with its day and time, or Pick a time, whose row the card draws as its own footer line, since this right group never wraps; the item leaves the list and the count until then.
// The owner's zone, the clock.ownerZone setting, which Schedule's fixed times read in.
const readOwnerZone = async (): Promise<string> => {
  const { data, error } = await unwrap(
    apiClient.v1.settings[":key"].$get({ param: { key: "clock.ownerZone" }, query: {} }),
  )
  if (error) throw new Error(error.message)
  return String(data.value)
}

function Schedule({
  busy,
  held,
  hold,
  onSchedule,
  setPicking,
}: {
  busy: boolean
  held: string | undefined
  hold: { className?: string; focusableWhenDisabled?: boolean }
  onSchedule: (at: string) => void
  setPicking: (picking: boolean) => void
}) {
  const { data, isError } = useQuery({
    queryKey: ["setting", "clock.ownerZone"],
    queryFn: readOwnerZone,
    retry: false,
  })
  // a refused read (no extensions login yet, as on a fixture stack) reads in UTC, the setting's default
  const zone = isError ? "UTC" : data
  return (
    <DropdownMenu>
      <Hint content={held ?? "Snooze: put it away until a time, then it asks again"}>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Snooze"
              size="icon-sm"
              variant="outline"
              disabled={busy}
              {...hold}
            />
          }
        >
          <RiZzzLine />
        </DropdownMenuTrigger>
      </Hint>
      {/* a key in the menu stays in the menu, since a labelled ask's form would read a digit as its shortcut */}
      <DropdownMenuContent
        align="start"
        className="w-auto"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Ask again{zone ? ` (${zone})` : ""}</DropdownMenuLabel>
          {(zone ? scheduleChoices(new Date(), zone) : []).map((choice) => (
            <DropdownMenuItem key={choice.label} onClick={() => onSchedule(choice.at)}>
              {choice.label}
              <DropdownMenuShortcut>{choice.when}</DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setPicking(true)}>Pick a time…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// A key on a card as cardKey and reopenKey read it.
const keyOf = (event: KeyboardEvent): CardKey => {
  const target = event.target
  return {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    isComposing: event.nativeEvent.isComposing,
    key: event.key,
    keyCode: event.keyCode,
    metaKey: event.metaKey,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
    target:
      target instanceof HTMLTextAreaElement
        ? "box"
        : target instanceof HTMLInputElement && target.type === "radio"
          ? "choice"
          : "elsewhere",
  }
}

// One item as a card: its band, place line and title, then what Approve does or a draft's words, then, once answered or settled, the result on its own line above the footer, wrapping freely, then one footer row with an open card's actions on the left and, on the right, Schedule where offered, then Dismiss directly left of Reply. An item in Done is the same card.
export function InboxCard({
  done = false,
  item,
  marked,
  now,
  paused,
  updated,
}: {
  done?: boolean
  item: InboxItem
  marked: boolean
  now: number
  paused: boolean
  updated: boolean
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // a draft's words, editable where they stand
  const posted = item.kind === "draft" ? item.preview.text : ""
  const [draft, setDraft] = useState(posted)
  // the poster's bun run ask edit replaces the words in place, unless he has changed them
  const [synced, setSynced] = useState(posted)
  if (posted !== synced) {
    setSynced(posted)
    if (draft === synced) setDraft(posted)
  }
  const [pick, setPick] = useState<Side | null>(null)
  const [note, setNote] = useState("")
  const titleId = useId()
  const settle = async (write: () => Promise<unknown>) => {
    setPending(true)
    setError(null)
    try {
      await write()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
      setPending(false)
    }
  }
  const onAnswer: Answer = (action, text) =>
    settle(() => answerItem(item, action, text, note.trim() || undefined))
  // Schedule's picked time, drawn as its own footer line, since the card's right group never wraps
  const [picking, setPicking] = useState(false)
  const [day, setDay] = useState<Date | undefined>()
  const [time, setTime] = useState(PICKED_TIME)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const when = pickedAt(day, time, new Date())
  const onSchedule = (at: string) => void settle(() => scheduleItem(item.id, at))
  const closePicking = () => {
    setPicking(false)
    setDay(undefined)
    setTime(PICKED_TIME)
  }
  // a card a chat reply collapsed, opened back to its full self by Show actions, a click on it or E
  const [reopened, setReopened] = useState(false)
  const reopens = reopenable(item)
  const folded = reopens && !reopened
  const outcome = item.kind === "update" || (reopens && reopened) ? null : outcomeLine(item)
  // The taker's label in the outcome keeps the raw name on hover, as its band does: its first mention renders under the same Hint.
  const who = agentLabel(takenBy(item))
  const at = outcome === null ? -1 : outcome.indexOf(who)
  const linked = resultLink(item)
  const failed = sendFailed(item)
  const light = inboxLight(item)
  // an update, or an ask or draft still open, that he has not marked read; reading answers nothing
  const unread = item.readAt === null && (item.kind === "update" || item.status === "open")
  const read = () => (unread && !paused ? void settle(() => markRead([item.id])) : undefined)
  const busy = pending || paused
  // a row that just moved under him keeps its buttons focusable, dimmed and saying why, so focus stays put and a click meant for another item lands on none
  const hold = paused ? OFF_FOCUSABLE : {}
  const held = paused ? PAUSED_WHY : undefined
  const quiet =
    done || (outcome !== null && !failed) || (item.kind === "update" && item.readAt !== null)

  const title =
    item.kind === "update" && item.preview.link ? (
      <a
        href={item.preview.link}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
        onClick={read}
      >
        {item.title}
      </a>
    ) : unread ? (
      <button type="button" className="text-left" onClick={read}>
        {item.title}
      </button>
    ) : (
      item.title
    )

  const labels = labelsOf(item)
  // a labelled ask's footer sits in the form beside its Submit while it is open; every other card's answers from outside it
  const footerInForm = labels !== null && outcome === null
  const draftReady = item.kind === "draft" && outcome === null && !busy && draft.trim() !== ""
  // what Approve does, the card's description while it is open, or what a read-only update shows
  const preview =
    outcome !== null ? null : item.kind === "decision" ? (
      <Preview item={item} />
    ) : item.kind === "update" && (item.preview.text || item.preview.attachments) ? (
      <Shown preview={item.preview} />
    ) : null
  const body =
    outcome !== null ? null : labels ? (
      <AskChoices busy={busy} labels={labels} paused={paused} pick={pick} setPick={setPick} />
    ) : item.kind === "draft" ? (
      <div className="flex flex-col gap-3 text-sm">
        <SoFar thread={item.preview.thread} />
        <div className="flex flex-col gap-1.5">
          {item.preview.thread && (
            <p className="text-muted-foreground text-xs font-medium">Your reply</p>
          )}
          <Textarea
            aria-label={`Message to ${item.preview.to}`}
            className={BOX}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </div>
    ) : null

  // an answered or settled card's result is its description, read above the footer row and wrapping freely, so a long line never comes between its buttons
  const result =
    outcome === null ? null : (
      <QuestionnaireDescription className={cn("min-w-0 text-xs", light && iconTone(light))}>
        {at < 0 ? (
          outcome
        ) : (
          <>
            {outcome.slice(0, at)}
            <Hint content={takenBy(item)}>
              <span>{who}</span>
            </Hint>
            {outcome.slice(at + who.length)}
          </>
        )}
        {item.kind !== "update" &&
          item.answer &&
          "note" in item.answer &&
          item.answer.choice !== "settled" &&
          item.answer.note && (
            <span className="text-muted-foreground mt-1 block whitespace-pre-wrap">
              Your note: {item.answer.note}
            </span>
          )}
        {linked && (
          <>
            {" · "}
            <a
              href={linked.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1 hover:underline",
                light === "done" && "text-success",
              )}
            >
              {linked.label}
              <RiExternalLinkLine className="size-3" aria-hidden />
            </a>
          </>
        )}
      </QuestionnaireDescription>
    )

  const left =
    outcome !== null ? (
      retryable(item) && (
        <Hint content={held}>
          <Button
            size="sm"
            disabled={busy}
            {...hold}
            onClick={() => void settle(() => retryItem(item.id))}
          >
            <RiRefreshLine data-icon="inline-start" />
            Retry
          </Button>
        </Hint>
      )
    ) : item.kind === "decision" ? (
      labels ? null : (
        // a labelled ask's Send is the form's own Submit; no card takes Edit, since the note carries any change
        <>
          <Hint content={held}>
            <Button
              size="sm"
              variant="outline"
              className={SIDE_TONES.approve}
              disabled={busy}
              {...hold}
              onClick={() => void onAnswer("approve")}
            >
              <RiCheckLine data-icon="inline-start" />
              Approve
            </Button>
          </Hint>
          <Hint content={held}>
            <Button
              size="sm"
              variant="outline"
              className={SIDE_TONES.deny}
              disabled={busy}
              {...hold}
              onClick={() => void onAnswer("deny")}
            >
              <RiCloseLine data-icon="inline-start" />
              Deny
            </Button>
          </Hint>
        </>
      )
    ) : item.kind === "draft" ? (
      <>
        <Hint content={held}>
          <Button
            size="sm"
            variant="outline"
            className={SIDE_TONES.approve}
            {...hold}
            disabled={!draftReady}
            onClick={() => void onAnswer("send", draft)}
          >
            <RiSendPlaneLine data-icon="inline-start" />
            Send
          </Button>
        </Hint>
        {canDraft(item) && (
          <Hint
            content={
              paused ? PAUSED_WHY : "Save it as a draft in Slack, for you to finish and send"
            }
          >
            <Button
              size="sm"
              variant="outline"
              className={DRAFT_TONE}
              {...hold}
              disabled={!draftReady}
              onClick={() => void onAnswer("draft", draft)}
            >
              <RiDraftLine data-icon="inline-start" />
              Draft
            </Button>
          </Hint>
        )}
        <Hint content={held}>
          <Button
            size="sm"
            variant="outline"
            className={SIDE_TONES.deny}
            disabled={busy}
            {...hold}
            onClick={() => void onAnswer("discard")}
          >
            <RiCloseLine data-icon="inline-start" />
            Discard
          </Button>
        </Hint>
      </>
    ) : item.kind === "update" && item.preview.approve ? (
      // a pending Yard post's Approve opens Yard's approve page in the browser, where the owner is signed in, since a token never approves (the tier-two rule)
      <Button
        size="sm"
        variant="outline"
        className={SIDE_TONES.approve}
        render={<a href={item.preview.approve} target="_blank" rel="noopener noreferrer" />}
        nativeButton={false}
        onClick={read}
      >
        <RiExternalLinkLine data-icon="inline-start" />
        Approve
      </Button>
    ) : null

  const right = (
    <div className="ml-auto flex shrink-0 gap-2">
      {/* Archive sets the ask aside on the Archived shelf, its icon the shelf's; a draft's own red Discard already says no, so it stays off drafts */}
      {!done && !folded && outcome === null && item.kind === "decision" && (
        <Hint
          content={
            held ??
            "Archive: set it aside, you will talk more about it later; what is moving keeps moving"
          }
        >
          <Button
            aria-label="Archive"
            size="icon-sm"
            variant="outline"
            disabled={busy}
            {...hold}
            onClick={() => void onAnswer("clear")}
          >
            <RiArchive2Line />
          </Button>
        </Hint>
      )}
      {!done && !folded && schedulable(item) && (
        <Schedule
          busy={busy}
          held={held}
          hold={hold}
          onSchedule={onSchedule}
          setPicking={setPicking}
        />
      )}
      {/* an archived card, muted on its shelf, still takes Dismiss, which sends it to Done */}
      {(!done || item.status === "cleared") && dismissable(item) && (
        <Hint content={held ?? "Dismiss: it goes to Done"}>
          <Button
            aria-label="Dismiss"
            size="icon-sm"
            variant="outline"
            disabled={busy}
            {...hold}
            onClick={() => void settle(() => dismissItems([item.id]))}
          >
            <RiCheckDoubleLine />
          </Button>
        </Hint>
      )}
      {reopens && <Reopen open={reopened} setOpen={setReopened} />}
      <ChatAbout item={item} />
    </div>
  )

  const footer = (
    <CardFooter className="flex-wrap gap-2">
      {footerInForm ? (
        // shadcn's questionnaire actions in a row that wraps on a narrow card: Submit first, off until a side is picked and saying why on hover and focus, then the card's own buttons
        <QuestionnaireActions className="flex flex-wrap">
          <Hint content={held ?? sendWhy(pick) ?? undefined}>
            <QuestionnaireSubmit
              // green as Approve, or red once Deny is the pick it sends
              className={SIDE_TONES[pick ?? "approve"]}
              disabled={busy || pick === null}
              render={<Button size="sm" variant="outline" {...OFF_FOCUSABLE} />}
              size="sm"
              variant="outline"
            >
              <RiSendPlaneLine data-icon="inline-start" />
              Send
            </QuestionnaireSubmit>
          </Hint>
          {left}
          {right}
        </QuestionnaireActions>
      ) : (
        <>
          {left}
          {right}
        </>
      )}
      {picking && !done && !folded && schedulable(item) && (
        // shadcn's date and time picker: a day from the Calendar, a time from the field, in this browser's time zone
        <div className="flex basis-full flex-wrap items-center gap-2">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Day to ask again"
                  className="w-32 justify-between font-normal"
                />
              }
            >
              {day
                ? day.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    weekday: "short",
                  })
                : "Pick a day"}
              <RiArrowDownSLine data-icon="inline-end" />
            </PopoverTrigger>
            {/* a key in the calendar stays in the calendar, since a labelled ask's form would read a digit as its shortcut */}
            <PopoverContent
              align="start"
              className="w-auto overflow-hidden p-0"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Calendar
                mode="single"
                selected={day}
                disabled={{ before: new Date() }}
                onSelect={(picked) => {
                  setDay(picked)
                  setCalendarOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
          <Input
            aria-label="Time to ask again"
            className="bg-background w-28 appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            onKeyDown={(event) => {
              // a key here stays in the field, so an E typed into it never folds a reopened card
              event.stopPropagation()
              if (event.key === "Escape") closePicking()
              // Enter here sets nothing and submits no form: Set does that
              if (event.key === "Enter") event.preventDefault()
            }}
          />
          <Button
            size="sm"
            disabled={busy || when === null}
            onClick={() => {
              closePicking()
              if (when) onSchedule(when.toISOString())
            }}
          >
            Set
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={closePicking}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="text-destructive basis-full text-xs">{error}</p>}
    </CardFooter>
  )

  return (
    <Card
      id={needsYouAnchor(item.id)}
      role="listitem"
      // focusable from script alone, so taking the pill can hand focus to the card it put on top
      tabIndex={-1}
      size="sm"
      // the item a reply is being written about, until it is sent
      className={cn(
        // no outer card: the item sits flat on the Inbox, edge to edge, under its KindBand
        "focus-visible:ring-ring/50 wrap-anywhere overflow-visible rounded-none bg-transparent px-0 pt-0 ring-0 outline-none focus-visible:ring-[3px] [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-footer]]:rounded-none [&_[data-slot=card-footer]]:border-t-0 [&_[data-slot=card-footer]]:bg-transparent [&_[data-slot=card-footer]]:px-0 [&_[data-slot=card-header]]:px-0",
        marked && "ring-ring ring-2",
        folded && "cursor-pointer",
      )}
      // a click on a card a chat reply collapsed opens it, and E opens or folds it, with focus anywhere in the card but its box
      onClick={
        folded
          ? (event) => {
              if (!(event.target as Element).closest("a, button, input, textarea"))
                setReopened(true)
            }
          : undefined
      }
      onKeyDown={
        reopens
          ? (event) => {
              if (!reopenKey(keyOf(event))) return
              event.preventDefault()
              setReopened(!reopened)
            }
          : undefined
      }
    >
      <KindBand
        busy={busy}
        item={item}
        now={now}
        onRead={() => read()}
        unread={unread}
        updated={updated}
      />
      {/* the card is one question on shadcn's Questionnaire, composed with the Card's slots as shadcn's own card example does: its title and description are the question's; a labelled ask's footer sits in the form beside its Submit, while every other card's footer answers from outside it, so a key pressed on one of its buttons never submits it */}
      <Questionnaire
        // a contents box, so the card's slots lay out as they would with no form between them
        className="contents"
        shortcuts="numbers"
        // an answer unmounts the choices it was checked against, which the Questionnaire then reads as unanswered and marks aria-invalid, so the answered card starts a fresh one
        key={outcome === null ? "open" : "answered"}
        defaultItem={QUESTION}
        onSubmit={(event) => {
          event.preventDefault()
          if (pick && !busy) void onAnswer(pick)
        }}
        // Cmd or Ctrl+Enter submits the question: a labelled ask's picked side through the Questionnaire's submit, nothing before a pick, and in any other card's box what the box holds, through the button it feeds; read as the key comes down, before the Questionnaire's own handler, so a key on a link or a button reaches the browser alone
        onKeyDownCapture={(event) => {
          const action = cardKey(keyOf(event), {
            choosing: footerInForm,
            draftReady,
            picked: pick !== null,
          })
          if (action === null) return
          if (action === "leave") return event.stopPropagation()
          event.preventDefault()
          if (action === "send") void onAnswer("send", draft)
        }}
      >
        <QuestionnaireItem
          aria-labelledby={titleId}
          name={QUESTION}
          className="gap-(--card-spacing)"
        >
          {/* one column no wider than the card, so a wide table or drawing in the ask scrolls inside it rather than stretching the card */}
          <CardHeader className="grid-cols-[minmax(0,1fr)]">
            <Place item={item} />
            <QuestionnaireTitle
              id={titleId}
              render={<CardTitle />}
              // the card's own gap spaces the title from what follows, so it takes none of the bare Questionnaire's room below a title with no description
              className={cn(
                "flex items-start gap-2 [&:not(:has(~[data-slot=questionnaire-description]))]:mb-0",
                quiet && "text-muted-foreground font-normal",
              )}
            >
              <span className={LEAD}>
                {/* the unread dot stands in for an update's light; an ask keeps its light, and its ✓✓ says unread */}
                {unread && !light && (
                  <span aria-hidden className="bg-primary size-2 rounded-full" />
                )}
                {light && <Light state={light} />}
              </span>
              {title}
              {unread && <span className="sr-only"> (unread)</span>}
            </QuestionnaireTitle>
            {preview && (
              <QuestionnaireDescription
                render={<CardDescription />}
                // every ask's words read small, a Slack message's and a ticket's included
                // its files sit gap-3 below the words, as the choices sit below the files
                className="flex flex-col gap-1 text-xs [&>[data-slot=attachment-thumbs]]:mt-2"
              >
                {preview}
              </QuestionnaireDescription>
            )}
            {result}
          </CardHeader>
          {body && <CardContent>{body}</CardContent>}
          {/* the card's last block before its buttons: his note, which goes with whatever he answers */}
          {outcome === null && item.kind !== "update" && !folded && (
            // the same gap-2 above it as between the choices
            <CardContent className="mt-[calc(--spacing(2)-var(--card-spacing))]">
              <NoteBox
                disabled={busy}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </CardContent>
          )}
        </QuestionnaireItem>
        {footerInForm && footer}
      </Questionnaire>
      {!footerInForm && footer}
    </Card>
  )
}

// The note under an ask, as tall as its first choice whatever that grows to (a Hint's render overwrites the choice's own data-slot, so it is read as the choices' first child), and growing past it as he types; as tall as an Approve choice on a card with no choices.
function NoteBox(props: Pick<ComponentProps<typeof Textarea>, "disabled" | "onChange" | "value">) {
  const box = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const area = box.current
    const choice = area
      ?.closest("[role=listitem]")
      ?.querySelector<HTMLElement>("[data-slot=questionnaire-choices] > *")
    if (!area || !choice) return
    const observer = new ResizeObserver(() => {
      area.style.minHeight = `${choice.offsetHeight}px`
    })
    observer.observe(choice)
    return () => observer.disconnect()
  }, [])
  return (
    <Textarea
      ref={box}
      aria-label="Comment"
      className={cn("min-h-14 py-2", BOX)}
      placeholder="Add an optional comment"
      {...props}
    />
  )
}

// Taking what waits behind the pill glides the rows already in view down from the top while the taken ones fade in above them, this long; nothing moves under reduced motion.
const GLIDE_MS = 300

function glide(list: HTMLElement | null, taken: number, below: HTMLElement | null) {
  if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const rows = [...list.children] as HTMLElement[]
  const first = rows[0]
  const kept = rows[taken]
  if (!first || !kept) return
  const by = kept.offsetTop - first.offsetTop
  const timing = { duration: GLIDE_MS, easing: "ease-out" }
  for (const row of [...rows.slice(taken), ...(below ? [below] : [])])
    row.animate([{ transform: `translateY(-${by}px)` }, { transform: "none" }], timing)
  for (const row of rows.slice(0, taken)) row.animate([{ opacity: 0 }, { opacity: 1 }], timing)
}

// The pill comes in sliding down and fading in, and fades out, this long; under reduced motion it just appears and goes.
const PILL_MS = 200

// What waits behind the pill, kept PILL_MS past the last so the pill fades out with the words it had; null once it has gone.
function usePill(count: number): { count: number; leaving: boolean } | null {
  const [last, setLast] = useState(count)
  useEffect(() => {
    if (count > 0) {
      setLast(count)
      return
    }
    const timer = setTimeout(() => setLast(0), PILL_MS)
    return () => clearTimeout(timer)
  }, [count])
  const shown = count || last
  return shown > 0 ? { count: shown, leaving: count === 0 } : null
}

// The rows that just moved under him, by their ids in order joined with spaces (null while the inbox loads), each paused for MOVED_PAUSE_MS from its latest move.
function useMovedPause(key: string | null): ReadonlySet<string> {
  const before = useRef<string[] | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [paused, setPaused] = useState<ReadonlyMap<string, number>>(new Map())
  useLayoutEffect(() => {
    const step = movedStep(before.current, key === null ? null : key ? key.split(" ") : [])
    before.current = step.before
    if (step.moved.length === 0) return
    const until = Date.now() + MOVED_PAUSE_MS
    setPaused((now) => new Map([...now, ...step.moved.map((id) => [id, until] as const)]))
    // each wake ends only its own move's pause, so a later move's stays whatever the clock reads
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setPaused((now) => new Map([...now].filter(([, at]) => at > until)))
    }, MOVED_PAUSE_MS)
    timers.current.add(timer)
  }, [key])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  return new Set(paused.keys())
}

// Whether the open items start open; the shelves under them start shut.
export const FOLDS_OPEN = { open: true } as const

// A panel clips for its fold, so it reaches over the pane's side padding and pads back, and a card's band and round ends show whole; links in a card keep their own look
const SHELVES =
  "[&_[data-slot=accordion-content]]:-mx-(--pane-x) [&_[data-slot=accordion-content]]:px-(--pane-x)"
const SHELF_PANEL = "[&_a]:no-underline [&_p:not(:last-child)]:mb-0"

// A shelf's row: its icon, its name and how many it holds, the count a mono outline label; an empty shelf's row is grayed and shut by its disabled item.
export function ShelfLabel({
  count,
  icon: Icon,
  label,
  unread,
}: {
  count?: number
  icon: RemixiconComponentType
  label: string
  unread?: number
}) {
  return (
    <span className="text-muted-foreground flex items-center gap-2">
      <Icon className="size-3.5" aria-hidden />
      {label}
      {/* small, beside the row's words */}
      {count !== undefined && (
        <Badge variant="outline" className="text-2xs h-4 px-1.5 font-mono tabular-nums">
          {count}
        </Badge>
      )}
      {unread !== undefined && <span className="sr-only">, {unread} unread</span>}
    </span>
  )
}

// A shelf header's ✓, an icon alone as the open row's Mark all as read is, gone once nothing on the shelf is left to dismiss
export function ShelfDismiss({
  disabled,
  ids,
  label,
  onDismiss,
}: {
  disabled: boolean
  ids: string[]
  label: string
  onDismiss: (ids: string[]) => void
}) {
  if (ids.length === 0) return null
  return (
    <div className="absolute top-1.5 right-[calc(var(--pane-x,0px)+1.75rem)]">
      <Hint content={label}>
        <Button
          aria-label={label}
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground hover:bg-transparent dark:hover:bg-transparent"
          disabled={disabled}
          onClick={() => onDismiss(ids)}
        >
          <RiCheckLine />
        </Button>
      </Hint>
    </div>
  )
}

// The pill that puts what arrived on top, the same xs outline Button as Mark all as read beside it.
export function NewPill({
  count,
  leaving,
  onTake,
  ref,
}: {
  count: number
  leaving: boolean
  onTake: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    // white, the one call to act on the open row
    <Button
      ref={ref}
      size="xs"
      aria-hidden={leaving || undefined}
      tabIndex={leaving ? -1 : undefined}
      className={cn(
        "shrink-0 duration-200 ease-out",
        leaving
          ? "fill-mode-forwards pointer-events-none motion-safe:animate-out motion-safe:fade-out-0 motion-reduce:hidden"
          : "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2",
      )}
      onClick={onTake}
    >
      <RiArrowUpLine data-icon="inline-start" />
      {/* in a pane too narrow for the whole line it reads as its count alone, so the line never runs past its pane */}
      <span aria-hidden className="@sm:hidden">
        {count} new
      </span>
      <span className="sr-only @sm:not-sr-only">{newLabel(count)}</span>
    </Button>
  )
}

// Playground's Inbox: one list of cards, each keeping its place while he looks, what arrived since waiting behind a pill until he takes it, then In progress, Snoozed, Archived and Done as rows that open and shut.
export function Inbox({ viewing }: { viewing: boolean }) {
  const { allowed } = useDashboard()
  const { data, error, isPending } = useInbox(allowed)
  const queryClient = useQueryClient()
  const now = useNow()
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  // the ids in the order he sees them, set on the first read and when he takes what waits behind the pill
  const [order, setOrder] = useState<string[] | null>(null)
  const items = data?.items ?? []
  // answered and read items leave the list for Done ten minutes after they settle, one dismissed or closed by its poster at once
  const { archived, done, progress, shown } = inboxView(items, now)
  const snoozed = data?.snoozed ?? []
  const { held, rows } = pinnedView(shown, order)
  const pill = usePill(held.length)
  // the look before this one and the newest change as this one began: a card changed between the two reads Updated until he looks away and back, while one that changes as he looks shows in place
  const [look, setLook] = useState<{
    since: string | null
    upto: string | null
  } | null>(null)
  if (viewing && data && look === null)
    setLook({ since: readMark("inbox"), upto: inboxMark(items) })
  if (!viewing && look !== null) setLook(null)
  const updated = (item: InboxItem) => look !== null && updatedSince(item, look.since, look.upto)
  const rowIds = rows.map((item) => item.id)
  if (data && order?.join(" ") !== rowIds.join(" ")) setOrder(rowIds)
  const paused = useMovedPause(data ? [...rowIds, ...done.map((item) => item.id)].join(" ") : null)
  const list = useRef<HTMLDivElement>(null)
  const below = useRef<HTMLDivElement>(null)
  const [listOpen, setListOpen] = useState<boolean>(FOLDS_OPEN.open)
  const [shelvesOpen, setShelvesOpen] = useState<string[]>([])
  const taken = useRef(0)
  const pillButton = useRef<HTMLButtonElement>(null)
  const take = () => {
    setListOpen(true)
    taken.current = held.length
    setOrder([...held.map((item) => item.id), ...rowIds])
  }
  useLayoutEffect(() => {
    if (taken.current === 0) return
    glide(list.current, taken.current, below.current)
    focusAfterTake(
      pillButton.current,
      document.activeElement,
      list.current?.firstElementChild as HTMLElement | null,
    )?.focus({ preventScroll: true })
    taken.current = 0
  })
  // a link to an item (a Waiting on your inbox badge, Playground's row) scrolls the list to it once it is read
  useNeedsYouTarget(data !== undefined, (anchor) => {
    // one still behind the pill takes what waits, so the next try finds its row
    if (held.some((item) => needsYouAnchor(item.id) === anchor)) {
      take()
      return false
    }
    // a folded list opens first, so the next try finds its row
    if (!listOpen && rows.some((item) => needsYouAnchor(item.id) === anchor)) {
      setListOpen(true)
      return false
    }
    const row = document.getElementById(anchor)
    row?.scrollIntoView({ block: "center" })
    // a row in a hidden tab cannot scroll yet, so it is tried again once its tab shows
    return row !== null && row.offsetParent !== null
  })
  const picked = useReply()
  const typed = useTypedReply()
  const reply = picked ?? typed
  if (isPending) return <CenterSpinner />
  if (error) return <p className="text-destructive text-sm">{error.message}</p>
  const summary = inboxSummary(shown)
  // what Mark all as read marks: every unread update, ask and draft on screen, each staying in the list as it is until done
  const unreadIds = rows
    .filter((item) => item.readAt === null && (item.kind === "update" || item.status === "open"))
    .map((item) => item.id)
  const clearing = unreadIds.length
  const shelfSizes: Record<string, number> = {
    Archived: archived.length,
    Done: done.length,
    "In progress": progress.length,
    Snoozed: snoozed.length,
  }
  const actions = (pill || rows.length > 0) && (
    <div className="absolute top-1.5 right-[calc(var(--pane-x,0px)+1.75rem)] flex items-center gap-2">
      {pill && <NewPill ref={pillButton} count={pill.count} leaving={pill.leaving} onTake={take} />}
      {/* an icon alone, bare like the chevron beside it: the card's ✓ while anything is unread, its muted ✓✓ once all is read */}
      {clearing === 0 ? (
        <span className="text-muted-foreground grid size-6 place-items-center">
          <RiCheckDoubleLine className="size-3" aria-label="All read" />
        </span>
      ) : (
        <Hint content={`Mark all as read: ${clearing} stay in the list until done`}>
          <Button
            aria-label="Mark all as read"
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground hover:bg-transparent dark:hover:bg-transparent"
            disabled={bulkPending}
            onClick={() => void bulk(() => markRead(unreadIds))}
          >
            <RiCheckLine />
          </Button>
        </Hint>
      )}
    </div>
  )
  const bulk = async (write: () => Promise<unknown>) => {
    setBulkPending(true)
    setBulkError(null)
    try {
      await write()
    } catch (failure) {
      setBulkError((failure as Error).message)
    } finally {
      await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
      setBulkPending(false)
    }
  }
  return (
    <section aria-label="Inbox" className="@container flex flex-col gap-3">
      {/* one accordion, each row an icon, its words and a count: the open items first, then the shelves, an empty row grayed and shut */}
      <Accordion
        multiple
        className={SHELVES}
        // an empty row is always shut, so an Inbox with nothing in a row never shows it open on a blank panel; the open list keeps his choice while it is empty, so it shows again when items come
        value={[
          ...(listOpen && rows.length > 0 ? ["open"] : []),
          ...shelvesOpen.filter((key) => key === "Preview" || (shelfSizes[key] ?? 0) > 0),
        ]}
        onValueChange={(value: string[]) => {
          if (rows.length > 0) setListOpen(value.includes("open"))
          setShelvesOpen(value.filter((key) => key !== "open"))
        }}
      >
        {/* the new pill and Mark all as read sit on the open row's right, before its chevron, laid over the row since a button cannot sit inside its trigger */}
        <AccordionItem value="open" disabled={rows.length === 0} className={SHELF_ITEM}>
          <AccordionTrigger
            className={SHELF_ROW}
            header={(props) => (
              <h3 {...props} className={cn(props.className, STICKY_HEADER, OPEN_HEADER)}>
                {props.children}
                {actions}
              </h3>
            )}
          >
            {/* room on the right for the pill and Mark all as read, so the chevron stays rightmost */}
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2",
                pill ? "pr-40" : rows.length > 0 && "pr-10",
              )}
            >
              <RiInboxLine className="size-3.5 shrink-0" aria-hidden />
              <span
                className={cn(
                  "truncate",
                  summary === null ? "text-muted-foreground" : "text-foreground",
                )}
              >
                Inbox
              </span>
              <span className="sr-only">{summary ?? "All caught up"}</span>
              {/* the row reads Inbox and its count, zero included, as each shelf does, the summary for a screen reader */}
              <Badge variant="outline" className="text-2xs h-4 px-1.5 font-mono tabular-nums">
                {shown.length}
              </Badge>
            </span>
            <ShelfMark empty={shown.length === 0} />
          </AccordionTrigger>
          {/* kept mounted while folded, so a fold keeps what a card holds: a draft typed, a picked side, a half-set Snooze, a reopened card */}
          <AccordionContent keepMounted className={SHELF_PANEL}>
            {bulkError && <p className="text-destructive pt-4 text-xs">{bulkError}</p>}
            <div ref={list} role="list" className="flex flex-col gap-6 pt-8 pb-3">
              {rows.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  marked={item.ref === reply?.ref}
                  now={now}
                  paused={paused.has(item.id)}
                  updated={updated(item)}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
        <div ref={below}>
          {(
            [
              ["In progress", RiProgress4Line, progress, false],
              ["Snoozed", RiZzzLine, snoozed, false],
              ["Archived", RiArchive2Line, archived, true],
              ["Done", RiCheckDoubleLine, done, true],
            ] as const
          ).map(([label, Icon, shelf, muted]) => (
            <AccordionItem
              key={label}
              value={label}
              disabled={shelf.length === 0}
              className={SHELF_ITEM}
            >
              <AccordionTrigger
                // Done at 0 unread reads as muted as an empty shelf, yet still opens to its history
                className={cn(
                  SHELF_ROW,
                  label === "Done" &&
                    shelf.filter(dismissable).length === 0 &&
                    "opacity-50 hover:opacity-100 aria-expanded:opacity-100",
                )}
                header={(props) => (
                  <h3 {...props} className={cn(props.className, STICKY_HEADER)}>
                    {props.children}
                    {/* the Archived shelf empties in one click, its items to Done; Done marks what settled on its own read, greyed once all are */}
                    {label !== "Snoozed" && label !== "In progress" && shelf.length > 0 && (
                      <ShelfDismiss
                        disabled={bulkPending}
                        ids={shelf.filter(dismissable).map((item) => item.id)}
                        label={
                          label === "Archived" ? "Dismiss all archived" : "Mark all done as read"
                        }
                        onDismiss={(ids) => void bulk(() => dismissItems(ids))}
                      />
                    )}
                  </h3>
                )}
              >
                {/* every shelf counts what it holds, Done its history too, its ✓ and its muting saying whether any is unread */}
                <ShelfLabel
                  count={shelf.length}
                  icon={Icon}
                  label={label}
                  unread={label === "Done" ? shelf.filter(dismissable).length : undefined}
                />
                <ShelfMark empty={shelf.length === 0} />
              </AccordionTrigger>
              <AccordionContent className={SHELF_PANEL}>
                <div role="list" className="flex flex-col gap-3 pt-8 pb-3">
                  {shelf.map((item) => (
                    <InboxCard
                      key={item.id}
                      done={muted}
                      item={item}
                      marked={item.ref === reply?.ref}
                      now={now}
                      paused={paused.has(item.id)}
                      updated={updated(item)}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
          {/* the Preview row under Done, there whether or not the Inbox holds anything: a live page from a dev stack or Previews, the pane's room below it as a browser */}
          <AccordionItem value="Preview" className={SHELF_ITEM}>
            <AccordionTrigger
              className={SHELF_ROW}
              header={(props) => <h3 {...props} className={cn(props.className, STICKY_HEADER)} />}
            >
              <ShelfLabel icon={RiWindowLine} label="Preview" />
              <ShelfMark />
            </AccordionTrigger>
            <AccordionContent className={SHELF_PANEL}>
              <div className="pt-3">
                <PreviewPane />
              </div>
            </AccordionContent>
          </AccordionItem>
        </div>
      </Accordion>
    </section>
  )
}
