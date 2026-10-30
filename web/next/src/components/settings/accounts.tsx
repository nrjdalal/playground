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
import { toast } from "@/components/ui/toast"
import { ACCOUNTS_QUERY_KEY, type AccountRow, accountWords, readAccounts } from "@/lib/accounts"
import { apiClient, unwrap } from "@/lib/api/client"
import { PROVIDER_ICONS } from "@/lib/status-icons"
import { useAccount } from "@/lib/system"

const ICONS = { claude: PROVIDER_ICONS.anthropic, glm: PROVIDER_ICONS.zai }

// Settings > Accounts: every Claude and GLM account the factory spends, each with whether its token is kept, Add account and Remove; the token is pasted once and goes to the Keychain, never back to the page. While the first read is pending it holds its space empty, never a placeholder box.
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
