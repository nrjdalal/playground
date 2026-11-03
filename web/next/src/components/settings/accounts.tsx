"use client"

import { RiDeleteBinLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { Hint } from "@/components/hint"
import { AddAccountDialog } from "@/components/settings/add-account-dialog"
import { SetUpSettings } from "@/components/settings/set-up-settings"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
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
import { toast } from "@/components/ui/toast"
import { ACCOUNTS_QUERY_KEY, type AccountRow, accountWords, readAccounts } from "@/lib/accounts"
import { apiClient, unwrap } from "@/lib/api/client"
import { withOwn } from "@/lib/own-account"
import { PROVIDER_ICONS } from "@/lib/status-icons"
import { useAccount } from "@/lib/system"

const ICONS = { claude: PROVIDER_ICONS.anthropic, glm: PROVIDER_ICONS.zai }

const KEY = "usage.accounts"

// Settings > Accounts: every Claude and GLM account the factory spends, each with whether its token is kept, Add account and Remove, and on a Claude row an Own account switch, whose account the login flip spends at a fifth unless it resets within a day; the token is pasted once and goes to the Keychain, never back to the page. While the first read is pending it holds its space empty, never a placeholder box.
export function Accounts() {
  const { data, error, isPending } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: readAccounts,
  })
  const accounts = data?.accounts
  // the extensions login, apart from useAccount's: Add account waits for a read that says it exists, and the step shows only on one that says it does not
  const setUp = data?.login === true
  const unset = data?.login === false
  const { account: login } = useAccount(true)
  const [removing, setRemoving] = React.useState<AccountRow | null>(null)
  const shown = React.useRef<AccountRow | null>(null)
  if (removing) shown.current = removing
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY })

  const remove = useMutation({
    mutationFn: async (row: AccountRow) => {
      const { data, error } = await unwrap(
        apiClient.v1.accounts[":provider"][":key"].$delete({
          param: { key: row.key, provider: row.provider },
        }),
      )
      if (error) throw new Error(error.message)
      return data
    },
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSuccess: (data) => {
      setRemoving(null)
      toast.add({ title: `${data.key} removed`, type: "success" })
      refresh()
    },
  })

  // reads usage.accounts whole, so a row the page has not drawn yet is written back as it is
  const markOwn = useMutation({
    mutationFn: async ({ own, row, scope }: { own: boolean; row: AccountRow; scope: string }) => {
      const read = await unwrap(
        apiClient.v1.settings[":key"].$get({ param: { key: KEY }, query: {} }),
      )
      if (read.error) throw new Error(read.error.message)
      const rows = Array.isArray(read.data.value)
        ? (read.data.value as Record<string, unknown>[])
        : []
      const { error } = await unwrap(
        apiClient.v1.settings[":key"].$put({
          param: { key: KEY },
          json: {
            by: "Settings",
            reason: `${own ? "Marked" : "Unmarked"} an account own in Settings`,
            scope,
            value: withOwn(rows, row.key, own),
          },
        }),
      )
      if (error) throw new Error(error.message)
    },
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSettled: refresh,
  })

  const title = shown.current ? accountWords(shown.current).title : ""
  return (
    <section aria-labelledby="settings-accounts" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="settings-accounts" className="text-muted-foreground text-sm font-medium">
          Accounts
        </h2>
        <AddAccountDialog disabled={!setUp} onAdded={refresh} />
      </div>
      {isPending ? (
        <div aria-busy="true" className="h-14" />
      ) : unset ? (
        <SetUpSettings />
      ) : error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Accounts could not be read</EmptyTitle>
            <EmptyDescription>{error.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : accounts?.length ? (
        <ItemGroup className="gap-2">
          {accounts.map((row) => {
            const words = accountWords(row, login?.email)
            const Icon = ICONS[row.provider]
            return (
              <Item key={`${row.provider}:${row.key}`} variant="outline" size="sm">
                <ItemMedia variant="icon">
                  <Icon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{words.title}</ItemTitle>
                  <ItemDescription className={row.stored ? undefined : "text-warning"}>
                    {words.description}
                  </ItemDescription>
                </ItemContent>
                {row.provider === "claude" && (
                  <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs max-sm:order-last max-sm:basis-full max-sm:justify-end">
                    <span>Own account</span>
                    <Switch
                      aria-label={`Own account: ${words.title}`}
                      checked={row.own}
                      disabled={!data?.scope || markOwn.isPending}
                      onCheckedChange={(own) => {
                        if (data?.scope) markOwn.mutate({ own, row, scope: data.scope })
                      }}
                      size="sm"
                    />
                  </label>
                )}
                <ItemActions>
                  <Hint content="Remove">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${words.title}`}
                      onClick={() => setRemoving(row)}
                    >
                      <RiDeleteBinLine />
                    </Button>
                  </Hint>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No accounts yet</EmptyTitle>
            <EmptyDescription>
              Add a Claude account by its email and a setup token, or a GLM key by a label.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${title}?`}
        description="It leaves the accounts your sessions spend, and its token leaves this Mac's Keychain."
        action="Remove"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing)
        }}
      />
    </section>
  )
}
