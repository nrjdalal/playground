"use client"

import { useQuery } from "@tanstack/react-query"

import { CheckRow, readLiveChecks } from "@/components/first-run/checks"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { LIVE_CHECKS_QUERY_KEY, fixTitle, toFix } from "@/lib/onboard"

// Settings > what first run left: each check still missing on this Mac, read live whatever the done mark says, with the fix the app runs for it and Re-check. Shown only while one is missing, so a Mac whose checks are done shows nothing here.
export function MacChecks() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: LIVE_CHECKS_QUERY_KEY,
    queryFn: readLiveChecks,
  })
  const missing = toFix(data?.checks ?? [])
  if (!missing.length) return null
  return (
    <section aria-labelledby="settings-mac" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="settings-mac" className="text-muted-foreground text-sm font-medium">
          {fixTitle(missing.length)}
        </h2>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          {isFetching && <Spinner />}
          Re-check
        </Button>
      </div>
      <ul className="grid gap-3">
        {missing.map((check) => (
          <CheckRow key={check.name} check={check} onSettled={() => void refetch()} signedIn />
        ))}
      </ul>
    </section>
  )
}
