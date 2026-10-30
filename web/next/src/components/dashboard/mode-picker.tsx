"use client"

import type { Worker } from "@api/hono"
import { RiArrowDownSLine } from "@remixicon/react"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { Hint } from "@/components/hint"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroupButton } from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"
import {
  changeMode,
  MODE_LABELS,
  modePicker,
  shownMode,
  type PendingMode,
  type PermissionMode,
} from "@/lib/permission-mode"

const READ_ONLY = "Approvals are off"

const isMode = (value: unknown): value is PermissionMode =>
  typeof value === "string" && Object.hasOwn(MODE_LABELS, value)

// The hosted session's permission mode in the composer's toolbar, as Shift+Tab switches it in a terminal, on AI Elements' Prompt Input menu, a dropdown radio group: the mode it runs in, and while approvals are on, a pick changes it. A session with no terminal of its own shows nothing.
export function ModePicker({ approvals, worker }: { approvals: boolean; worker: Worker }) {
  const picker = modePicker(worker, approvals)
  const [pending, setPending] = useState<PendingMode | null>(null)
  const change = useMutation({
    mutationFn: async (mode: PermissionMode) => {
      const { error } = await changeMode(worker.sessionId, mode)
      if (error) throw new Error(error.message)
    },
    onError: (error) => {
      setPending(null)
      toast.add({ title: error.message, type: "error" })
    },
  })
  if (!picker) return null
  // the pick is forgotten once the row has moved off the mode it was picked over, so a later change the session makes itself shows; until then the trigger takes no second pick
  if (pending && picker.mode !== pending.from) setPending(null)
  const mode = shownMode(pending, picker.mode)
  return (
    <DropdownMenu>
      <Hint
        content={
          picker.readOnly ? `${MODE_LABELS[mode]} mode. ${READ_ONLY}` : `${MODE_LABELS[mode]} mode`
        }
      >
        <DropdownMenuTrigger
          render={
            <InputGroupButton
              size="sm"
              variant="outline"
              aria-label={`Permission mode: ${MODE_LABELS[mode]}`}
              disabled={pending !== null}
              {...(picker.readOnly && { "aria-description": READ_ONLY })}
            />
          }
        >
          {MODE_LABELS[mode]}
          <RiArrowDownSLine />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start" className="w-48">
        {/* while approvals are off the list still opens to browse, but takes no pick */}
        <DropdownMenuRadioGroup
          disabled={picker.readOnly}
          value={mode}
          onValueChange={(next) => {
            if (!isMode(next) || next === mode) return
            setPending({ from: picker.mode, to: next })
            change.mutate(next)
          }}
        >
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
