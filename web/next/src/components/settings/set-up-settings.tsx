"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import { ACCOUNTS_QUERY_KEY } from "@/lib/accounts"
import { apiClient, unwrap } from "@/lib/api/client"
import { EXTENSIONS_QUERY_KEY } from "@/lib/extensions"

type Found = { exists: boolean; repo: string }

// Why settings need setting up, in the words every place that offers Set up settings shows.
export const SET_UP_SETTINGS_WHY =
  "Playground keeps your settings, accounts list and extensions in a private GitHub repo of yours."

// Settings' first step while no login is named, shared by Accounts, Extensions and the home's checklist: Set up settings checks the private repository on GitHub, names it in a confirm, then runs ext init for you, both sections read again once it lands, and onDone gets the repo. Inline, as the checklist's row, it shows its button alone: the row's title, Settings, stands in for its heading and the row shows SET_UP_SETTINGS_WHY.
export function SetUpSettings({
  inline,
  onDone,
}: {
  inline?: boolean
  onDone?: (repo: string) => void
}) {
  const queryClient = useQueryClient()
  const [found, setFound] = React.useState<Found | null>(null)
  const shown = React.useRef<Found | null>(null)
  if (found) shown.current = found
  const [refused, setRefused] = React.useState<string | null>(null)

  const check = useMutation({
    mutationFn: async () => {
      const { data, error } = await unwrap(apiClient.v1.extensions.init.check.$get())
      if (error) throw new Error(error.message)
      return data
    },
    onError: (error) => setRefused(error.message),
    onSuccess: (data) => {
      setRefused(null)
      setFound(data)
    },
  })
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await unwrap(apiClient.v1.extensions.init.$post())
      if (error) throw new Error(error.message)
      return data
    },
    onError: (error) => {
      setFound(null)
      setRefused(error.message)
    },
    onSuccess: (data) => {
      setFound(null)
      toast.add({ title: `Settings set up in ${data.repo}`, type: "success" })
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: EXTENSIONS_QUERY_KEY })
      onDone?.(data.repo)
    },
  })

  const repo = shown.current?.repo ?? ""
  const controls = (
    <>
      <Button size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
        {check.isPending ? "Checking GitHub…" : "Set up settings"}
      </Button>
      {refused && <p className="text-destructive text-xs">{refused}</p>}
      <ConfirmDialog
        open={found !== null}
        onOpenChange={(open) => {
          if (!open) setFound(null)
        }}
        title={`Set up settings in ${repo}?`}
        description={
          shown.current?.exists
            ? `Playground keeps your settings in ${repo}, your private repo on GitHub.`
            : `Playground makes ${repo} on GitHub, private, with issues, wiki and projects off, and keeps your settings there.`
        }
        action={run.isPending ? "Setting up…" : "Set up"}
        pending={run.isPending}
        onConfirm={() => run.mutate()}
      />
    </>
  )
  if (inline) return <div className="flex flex-col items-start gap-2">{controls}</div>
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Your settings aren&apos;t set up yet</EmptyTitle>
        <EmptyDescription>{SET_UP_SETTINGS_WHY}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{controls}</EmptyContent>
    </Empty>
  )
}
