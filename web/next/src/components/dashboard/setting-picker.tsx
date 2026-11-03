"use client"

import type { Worker } from "@api/hono"
import { RiArrowDownSLine } from "@remixicon/react"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { Hint } from "@/components/hint"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroupButton } from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"
import {
  changeSetting,
  EFFORT_LABELS,
  isEffort,
  isModel,
  MODEL_LABELS,
  reportedSetting,
  shownValue,
  type Pending,
  type SessionEffort,
  type SessionModel,
  type SessionSetting,
} from "@/lib/session-setting"

// The session's model and effort in the composer's toolbar, beside the mode picker, as /model and /effort set them in a terminal: one menu with a radio group for each, where a pick sets that value on the session as the owner's own act (typed into a dispatcher, through the SDK on the hosted session).
export function SettingPicker({ worker }: { worker: Worker }) {
  const reported = reportedSetting(worker)
  const [model, setModel] = useState<Pending<SessionModel> | null>(null)
  const [effort, setEffort] = useState<Pending<SessionEffort> | null>(null)
  const change = useMutation({
    mutationFn: async (setting: SessionSetting) => {
      const { error } = await changeSetting(worker.sessionId, setting)
      // Claude Code holds the command while it compacts and runs it once free, so the pick stays shown
      if (error && "delivery" in error && error.delivery === "QUEUED") return { queued: true }
      if (error) throw new Error(error.message)
      return { queued: false }
    },
    onSuccess: ({ queued }) => {
      if (queued) toast.add({ title: `${worker.name} takes it once free`, type: "info" })
    },
    onError: (error, setting) => {
      if ("model" in setting) setModel(null)
      else setEffort(null)
      toast.add({ title: error.message, type: "error" })
    },
  })
  // a pick is forgotten once the row has moved off the value it was picked over, so a later change the session makes itself shows
  if (model && reported.model !== model.from) setModel(null)
  if (effort && reported.effort !== effort.from) setEffort(null)
  const shownModel = shownValue(model, reported.model)
  const shownEffort = shownValue(effort, reported.effort)
  const words = [
    shownModel ? MODEL_LABELS[shownModel] : "Model",
    shownEffort ? EFFORT_LABELS[shownEffort] : "Effort",
  ].join(" · ")
  return (
    <DropdownMenu>
      <Hint content="Model and effort">
        <DropdownMenuTrigger
          render={
            <InputGroupButton
              size="sm"
              variant="outline"
              aria-label={`Model and effort: ${words}`}
              disabled={change.isPending}
            />
          }
        >
          {words}
          <RiArrowDownSLine />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Model</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={shownModel ?? ""}
            onValueChange={(next) => {
              if (!isModel(next) || next === shownModel) return
              setModel({ from: reported.model, to: next })
              change.mutate({ model: next })
            }}
          >
            {Object.entries(MODEL_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={shownEffort ?? ""}
            onValueChange={(next) => {
              if (!isEffort(next) || next === shownEffort) return
              setEffort({ from: reported.effort, to: next })
              change.mutate({ effort: next })
            }}
          >
            {Object.entries(EFFORT_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
