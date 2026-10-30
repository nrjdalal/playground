"use client"

import {
  RiArrowDownDoubleLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiBookOpenFill,
  RiEyeLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { cn } from "cn"
import type { ReactNode } from "react"

import { Checkpoint } from "@/components/checkpoint"
import { countLabel, type ChatMode } from "@/components/dashboard/chat-scroll"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// Emil Kowalski's ease-out for state shown and hidden (emilkowalski/skills, animate/SKILL.md).
const EASE_OUT = "ease-[cubic-bezier(0.23,1,0.32,1)]"

const WATCHING_HINT = "Watching the newest message. Scroll up or click to stop and read."
const READING_HINT = "Reading: the chat stays where you are. Click to watch the newest message."

// An icon button on the bar with its keys in its tooltip, focusable while disabled so focus is never dropped.
function BarButton({
  children,
  disabled,
  hint,
  keys,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  hint: string
  keys?: string
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            focusableWhenDisabled
            aria-label={label}
            aria-keyshortcuts={keys ? `Alt+${keys === "↑" ? "ArrowUp" : "ArrowDown"}` : undefined}
            className="data-disabled:opacity-50"
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2">
        {hint}
        {keys ? (
          <KbdGroup>
            <Kbd>⌥</Kbd>
            <Kbd>{keys}</Kbd>
          </KbdGroup>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

// One face of the toggle, its icon and words; both faces share one grid cell and crossfade, the leaving one shrinking a little, with no scale under reduced motion.
function Face({
  extra,
  Icon,
  shown,
  words,
}: {
  extra: ReactNode
  Icon: RemixiconComponentType
  shown: boolean
  words: string
}) {
  return (
    <span
      aria-hidden={!shown}
      data-shown={shown}
      className={cn(
        "col-start-1 row-start-1 inline-flex items-center justify-center gap-1 transition-[opacity,scale] duration-150",
        EASE_OUT,
        "data-[shown=false]:opacity-0 motion-safe:data-[shown=false]:scale-95",
      )}
    >
      <Icon className="size-4" />
      {words}
      {extra}
    </span>
  )
}

// The chat's Checkpoint bar, the Dashboard's one Checkpoint, its content spread across the row: on the left that the session waits on a picker, else how many messages are on their way, on the right Scroll to end while not at the end, ↑ and ↓ to his previous and next message, and the Watching / Reading toggle with how far behind it is or what arrived below. It stays on screen at one height from first paint, under every chat with or without a composer, and every slot keeps its place when it empties, so nothing moves.
export function ScrollBar({
  behindText,
  count,
  label,
  mode,
  next,
  oldest,
  onJump,
  onToEnd,
  onToggle,
  picker,
  prev,
  queued,
  toEnd,
}: {
  // Watching's "12s behind", null once caught up
  behindText: string | null
  // Reading's rows arrived and not yet seen
  count: number
  // the chat's name for its session, in the queue's words
  label: string
  mode: ChatMode
  next: boolean
  // ↑ has nowhere to go because his oldest loaded message is in view, and Load older brings earlier ones
  oldest: boolean
  onJump: (dir: "down" | "up") => void
  onToEnd: () => void
  onToggle: () => void
  // the session waits on a picker, which the left slot says over the queue
  picker: boolean
  prev: boolean
  // messages from here still on their way to the session; counted only past one, since each bubble says where its own is
  queued: number
  toEnd: boolean
}) {
  const watching = mode === "watching"
  return (
    <div data-slot="chat-checkpoint" className="@container shrink-0 pb-2">
      <Checkpoint className="w-full justify-between">
        <span className="min-w-0 truncate text-xs">
          {picker ? (
            <span className="text-caution">{label} waits on a picker</span>
          ) : queued > 1 ? (
            <>
              <span className="font-mono tabular-nums">{queued}</span>
              <span className="@max-sm:hidden"> messages on their way to {label}</span>
              <span className="@sm:hidden"> on their way</span>
            </>
          ) : null}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {/* its slot stays when hidden, and it leads the row so a hidden one leaves no gap between the arrows and the toggle */}
          <div
            inert={!toEnd}
            data-shown={toEnd}
            className={cn(
              "transition-[opacity,translate,scale,visibility] duration-180 data-[shown=false]:duration-140",
              EASE_OUT,
              "data-[shown=false]:invisible data-[shown=false]:opacity-0 motion-safe:data-[shown=false]:translate-y-1/4 motion-safe:data-[shown=false]:scale-95",
            )}
          >
            <BarButton hint="Scroll to end" label="Scroll to end" onClick={onToEnd}>
              <RiArrowDownDoubleLine className="size-4" />
            </BarButton>
          </div>
          <BarButton
            disabled={!prev}
            hint={
              !prev && oldest
                ? "Your oldest message here. Load older at the top brings earlier ones."
                : "Previous message of yours"
            }
            keys="↑"
            label="Previous message of yours"
            onClick={() => onJump("up")}
          >
            <RiArrowUpSLine className="size-4" />
          </BarButton>
          <BarButton
            disabled={!next}
            hint="Next message of yours"
            keys="↓"
            label="Next message of yours"
            onClick={() => onJump("down")}
          >
            <RiArrowDownSLine className="size-4" />
          </BarButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  data-slot="chat-mode"
                  data-mode={mode}
                  size="sm"
                  variant="outline"
                  pressed={watching}
                  onPressedChange={onToggle}
                  aria-label={watching ? WATCHING_HINT : READING_HINT}
                  className="rounded-full font-normal transition-[background-color,border-color,color] duration-150 ease-[ease]"
                >
                  <span className="grid">
                    {/* the widest labels, unseen, hold the toggle's width in every state */}
                    <span
                      aria-hidden
                      className="invisible col-start-1 row-start-1 inline-flex gap-1"
                    >
                      <span className="size-4" />
                      Watching · 120s behind
                    </span>
                    <span
                      aria-hidden
                      className="invisible col-start-1 row-start-1 inline-flex gap-1"
                    >
                      <span className="size-4" />
                      Reading · 99+<span className="@max-sm:hidden"> new</span>
                    </span>
                    <Face
                      Icon={RiEyeLine}
                      shown={watching}
                      words="Watching"
                      extra={
                        behindText ? (
                          <span className="text-muted-foreground">· {behindText}</span>
                        ) : null
                      }
                    />
                    <Face
                      Icon={RiBookOpenFill}
                      shown={!watching}
                      words="Reading"
                      extra={
                        count > 0 ? (
                          <span className="text-muted-foreground">
                            · {countLabel(count)}
                            <span className="@max-sm:hidden"> new</span>
                          </span>
                        ) : null
                      }
                    />
                  </span>
                </Toggle>
              }
            />
            <TooltipContent>{watching ? WATCHING_HINT : READING_HINT}</TooltipContent>
          </Tooltip>
          {/* only a change of band, or of Reading's count, is announced, beside the toggle since a named button's own text is never read out */}
          <span aria-live="polite" className="sr-only">
            {watching
              ? behindText
                ? "Behind"
                : "Caught up"
              : count > 0
                ? `${countLabel(count)} new`
                : ""}
          </span>
        </div>
      </Checkpoint>
    </div>
  )
}
