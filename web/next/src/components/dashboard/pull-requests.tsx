"use client"
"use no memo"

import type { Worker, WorkPull, WorkQueue } from "@api/hono"
import { site } from "@packages/config/site"
import { RiGitPullRequestLine } from "@remixicon/react"
import * as React from "react"

import { SetupEmpty } from "@/components/dashboard/setup-empty"
import { DataTable, textColumn, useStaticTable, type ColumnConfig } from "@/components/data-table"
import { Hint } from "@/components/hint"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { CenterSpinner } from "@/components/ui/spinner"
import { useAgentsBoard } from "@/lib/agents"
import { useNow } from "@/lib/dashboard"
import { useFolds } from "@/lib/folds"
import {
  etaOverdue,
  pullFields,
  pullProblemOf,
  viewPulls,
  type PullGroup,
  type PullRow,
  type PullSection,
} from "@/lib/pulls"
import { pullsSetup, type Setup } from "@/lib/setup"
import { PR_TONES, pullTone } from "@/lib/status-icons"
import { fullTime, relativeTime } from "@/lib/time"

// Five columns that fit a half-width pane at 1280: its last update rides under its title, as a row's muted line does.
const pullConfig: Record<string, ColumnConfig> = {
  pr: { flex: true, wrap: true },
  state: {},
  score: { extra: 6 },
  ci: { extra: 16 },
  approvals: {},
}

// A queued pull no agent works on: the board read nothing of its state, so its number claims none.
const UNPAIRED_TONE = { className: "text-inactive", words: "PR state unknown" }

// Its number in the PR's colour (the sidebar's), the colour's words for screen readers, then its title, one link to GitHub, over when it last changed, and, for a queued one, its place in the merge queue and when it is expected to merge.
const pullCell = (pr: PullRow, now: number) => {
  const tone = pr.unpaired ? UNPAIRED_TONE : PR_TONES[pullTone(pr)]
  return (
    <>
      <a href={pr.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
        <Hint content={tone.words}>
          <span className={`font-mono tabular-nums ${tone.className}`}>#{pr.number}</span>
        </Hint>
        <span className="sr-only"> {tone.words}</span> {pr.title}
      </a>
      {pr.updatedAt && (
        <span className="text-muted-foreground text-2xs block">
          Updated{" "}
          <Hint content={fullTime(pr.updatedAt)}>
            <time dateTime={pr.updatedAt}>{relativeTime(pr.updatedAt, new Date(now))}</time>
          </Hint>
        </span>
      )}
      {pr.place !== undefined && (
        <span className="text-muted-foreground text-2xs block">
          Queue place <span className="font-mono tabular-nums">{pr.place}</span>
          {pr.etaMerge &&
            (etaOverdue(pr.etaMerge, now) ? (
              ", overdue"
            ) : (
              <>
                {", merging "}
                <Hint content={fullTime(pr.etaMerge)}>
                  <time dateTime={pr.etaMerge} className="font-mono tabular-nums">
                    {relativeTime(pr.etaMerge, new Date(now))}
                  </time>
                </Hint>
              </>
            ))}
        </span>
      )}
    </>
  )
}

const pullColumns = (now: number) => [
  textColumn<PullRow>("pr", "Pull request", (pr) => pullCell(pr, now)),
  textColumn<PullRow>("state", "State", (pr) => pullFields(pr).state),
  textColumn<PullRow>("score", "Score", (pr) => pullFields(pr).score),
  textColumn<PullRow>("ci", "CI", (pr) => pullFields(pr).ci),
  textColumn<PullRow>("approvals", "Approvals", (pr) => pullFields(pr).approvals),
]

type Level = 3 | 4

function RepoPulls({
  group,
  level,
  now,
  titled,
}: {
  group: PullGroup
  level: Level
  now: number
  titled: boolean
}) {
  const heading = React.useId()
  const columns = React.useMemo(() => pullColumns(now), [now])
  const table = useStaticTable({
    columnConfig: pullConfig,
    columns,
    data: group.pulls,
    getRowId: (pr) => pr.url,
  })
  // under its section's accordion title, at the tab's level, the repository is one level down; with no section title it is the heading
  const Heading = level === 3 ? (titled ? "h4" : "h3") : titled ? "h5" : "h4"
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-1">
      <Heading id={heading} className="text-muted-foreground text-xs font-medium">
        {group.repo}
      </Heading>
      <DataTable aria-label={`Pull requests in ${group.repo}`} size="sm" table={table} />
    </section>
  )
}

const SECTION_WORDS = {
  open: "Open",
  parked: "Parked",
  queued: "Queued",
  settled: "Merged and closed",
} as const

// Queued and open pulls ask something of him, so they start open; parked and settled ones start folded.
const FOLDED: ReadonlySet<PullSection["kind"]> = new Set(["parked", "settled"])

// The stock panel's prose styling would underline every pull's link.
const PANEL = "flex flex-col gap-1 [&_a]:no-underline"

// One section of the tab, holding one table a repository: an accordion item under its title when another section shares the page.
function Section({
  level,
  now,
  section,
  titled,
}: {
  level: Level
  now: number
  section: PullSection
  titled: boolean
}) {
  const groups = section.groups.map((group) => (
    <RepoPulls key={group.repo} group={group} level={level} now={now} titled={titled} />
  ))
  return titled ? (
    <AccordionItem value={section.kind}>
      <AccordionTrigger header={level === 4 ? <h4 /> : undefined}>
        {SECTION_WORDS[section.kind]}
      </AccordionTrigger>
      <AccordionContent className={PANEL}>{groups}</AccordionContent>
    </AccordionItem>
  ) : (
    <section className="flex flex-col gap-1">{groups}</section>
  )
}

// The tab's sections, under GitHub's setup line when a read failed, so the queued pulls no read reached never hide why; one level down under the dashboard's own queue's title when the work queue shares the tab.
export function PullSections({
  level = 3,
  now,
  sections,
  setup,
}: {
  level?: Level
  now: number
  sections: PullSection[]
  setup: Setup | null
}) {
  const folds = useFolds(
    sections.map((section) => ({ id: section.kind, open: !FOLDED.has(section.kind) })),
  )
  const titled = sections.length > 1
  const shown = sections.map((section) => (
    <Section key={section.kind} level={level} now={now} section={section} titled={titled} />
  ))
  return (
    <>
      {setup && (
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{setup.title}.</span> {setup.description}
        </p>
      )}
      {titled ? (
        <Accordion multiple value={folds.value} onValueChange={folds.onValueChange}>
          {shown}
        </Accordion>
      ) : (
        shown
      )}
    </>
  )
}

const workConfig: Record<string, ColumnConfig> = {
  pr: { flex: true, wrap: true },
  waitsOn: {},
  approvals: {},
}

// Its repository and number, then its title, one link to GitHub, over the branch it merges into and when it last changed.
const workCell = (pr: WorkPull, now: number) => (
  <>
    <a href={pr.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
      <span className="text-muted-foreground font-mono tabular-nums">
        {pr.repo}#{pr.number}
      </span>{" "}
      {pr.title}
    </a>
    <span className="text-muted-foreground text-2xs block">
      Into {pr.base}
      {pr.updatedAt && (
        <>
          {", updated "}
          <Hint content={fullTime(pr.updatedAt)}>
            <time dateTime={pr.updatedAt}>{relativeTime(pr.updatedAt, new Date(now))}</time>
          </Hint>
        </>
      )}
    </span>
  </>
)

const workColumns = (now: number) => [
  textColumn<WorkPull>("pr", "Pull request", (pr) => workCell(pr, now)),
  textColumn<WorkPull>("waitsOn", "Waits on", (pr) => pr.waitsOn),
  textColumn<WorkPull>("approvals", "Approvals", (pr) => pr.approvals),
]

// The owner's open pulls in the work org under its label, in the order they can merge (ready first), one table across its repositories, under GitHub's setup line when the search failed: an accordion item of its own, starting open.
export function WorkPulls({ now, queue }: { now: number; queue: WorkQueue }) {
  const columns = React.useMemo(() => workColumns(now), [now])
  const table = useStaticTable({
    columnConfig: workConfig,
    columns,
    data: queue.pulls,
    getRowId: (pr) => pr.url,
  })
  const setup = pullsSetup(queue.problem)
  return (
    <Accordion multiple defaultValue={["work"]}>
      <AccordionItem value="work">
        <AccordionTrigger>{queue.label}</AccordionTrigger>
        <AccordionContent className={PANEL}>
          {setup ? (
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-medium">{setup.title}.</span>{" "}
              {setup.description}
            </p>
          ) : queue.pulls.length === 0 ? (
            <p className="text-muted-foreground text-sm">No open pull requests.</p>
          ) : (
            <DataTable aria-label={`${queue.label} pull requests`} size="sm" table={table} />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

// An agent's Pull requests pane, parked off the aside's bar until it is built again: the pull request it works on, or on the dispatcher's view every pull across the factory in merge order (queued first, then open, then parked, then merged and closed), one table a repository, all from the agents board's cached read.
export function PullRequests({ worker }: { worker: Worker }) {
  const now = useNow()
  const { data, error, isPending } = useAgentsBoard()
  const dispatcher = worker.role === "dispatcher"
  const sections = data ? viewPulls(data.agents, worker.sessionId, dispatcher, data.pullsQueue) : []
  const setup = pullsSetup(data ? pullProblemOf(data.agents, worker.sessionId, dispatcher) : null)
  // the work queue shows on the dispatcher's view alone, and only once a work org is set
  const work = dispatcher ? (data?.workQueue ?? null) : null
  const own = (level: Level) =>
    sections.length > 0 ? (
      <PullSections level={level} now={now} sections={sections} setup={setup} />
    ) : setup ? (
      <SetupEmpty icon={RiGitPullRequestLine} setup={setup} />
    ) : (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RiGitPullRequestLine />
          </EmptyMedia>
          <EmptyTitle>{dispatcher ? "No open pull requests" : "No pull request"}</EmptyTitle>
          <EmptyDescription>
            {dispatcher
              ? "Every open pull request an agent works on shows here."
              : "The pull request this agent works on shows here once it opens one."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <section aria-labelledby="pull-requests" className="flex flex-col gap-3">
      {/* on a phone the Pull requests tab below already says it */}
      <h2 id="pull-requests" className="text-sm font-medium max-md:sr-only">
        Pull requests
      </h2>
      {isPending ? (
        <CenterSpinner />
      ) : error ? (
        <p className="text-destructive text-sm">{error.message}</p>
      ) : work ? (
        <>
          <section aria-labelledby="own-queue" className="flex flex-col gap-1">
            <h3 id="own-queue" className="text-sm font-medium">
              {site.name}
            </h3>
            {own(4)}
          </section>
          <WorkPulls now={now} queue={work} />
        </>
      ) : (
        own(3)
      )}
    </section>
  )
}
