"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { ChecksCard, NO_API, ONBOARD_URL, readChecks } from "@/components/first-run/checks"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { config } from "@/lib/config"
import { firstRunView, gateOf, keptSignIn, markTried, triedJustNow } from "@/lib/first-run"
import { canContinue, ONBOARD_QUERY_KEY, refusalOf } from "@/lib/onboard"

const GATE_POLL_MS = 2_000
const NOT_KEPT =
  "You were signed in, but this browser did not keep the session. Allow cookies for this address, then try again."

// POST sign-in or finish: either sets the owner's session cookie, then the page loads again as the dashboard; else the refusal's words.
const signIn = async (route: "finish" | "sign-in"): Promise<string | undefined> => {
  const response = await fetch(`${ONBOARD_URL}/${route}`, {
    credentials: "include",
    method: "POST",
  }).catch(() => undefined)
  if (!response) return NO_API
  if (!response.ok) return refusalOf(await response.json().catch(() => null), response.status)
  markTried(sessionStorage, Date.now())
  window.location.reload()
  return undefined
}

// /dashboard's first run, in place of the dashboard while there is no database (gate setup) or no session (gate normal): a neutral frame while the owner is signed in by itself and the checks are read, then "Let's check this Mac" with Continue, which makes and signs in this Mac's owner. It opens no WebSocket and reads nothing on the owner rung. With no database yet it reads the gate every 2s and loads again once the database is up.
export function FirstRun({ gate }: { gate: "normal" | "setup" }) {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(
    gate === "setup" ? false : undefined,
  )
  const [refused, setRefused] = useState<string>()
  const [finishing, setFinishing] = useState(false)
  const tried = useRef(false)
  const checks = useQuery({
    enabled: signedIn === false,
    queryFn: readChecks,
    queryKey: ONBOARD_QUERY_KEY,
    retry: false,
  })
  const up = useQuery({
    enabled: gate === "setup",
    queryFn: async () => {
      const response = await fetch(`${config.api.url}/api/setup`, { cache: "no-store" })
      return gateOf(response.status)
    },
    queryKey: ["setup", "gate"],
    refetchInterval: GATE_POLL_MS,
  })

  useEffect(() => {
    if (up.data === "normal") window.location.reload()
  }, [up.data])

  useEffect(() => {
    if (gate === "setup" || tried.current) return
    tried.current = true
    void (async () => {
      if (triedJustNow(sessionStorage, Date.now())) {
        setRefused(NOT_KEPT)
        return setSignedIn(false)
      }
      const refusal = await signIn("sign-in")
      if (refusal === NO_API) setRefused(refusal)
      if (refusal) setSignedIn(false)
    })()
  }, [gate])

  const finish = async () => {
    setFinishing(true)
    const refusal = await signIn("finish")
    if (refusal) {
      setFinishing(false)
      setRefused(refusal)
    }
  }

  const view = firstRunView({ done: checks.data?.done, gate, signedIn })
  const failure = refused ?? checks.error?.message
  if (view === "frame" && !failure) return <main aria-busy="true" className="min-h-svh" />
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      {failure && (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {failure}
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {checks.data && (
        <ChecksCard
          checking={checks.isFetching}
          read={checks.data}
          recheck={() => void checks.refetch()}
          signedIn={false}
          footer={
            <Button
              disabled={
                finishing ||
                checks.isFetching ||
                gate === "setup" ||
                !(checks.data.done || canContinue(checks.data.checks))
              }
              onClick={finish}
            >
              {finishing && <Spinner />}
              Continue
            </Button>
          }
        />
      )}
    </main>
  )
}

// Mounted by a signed-in page: the tab's own sign-in stuck, so a later signed-out load signs in again rather than showing the cookie error.
export function SignInKept() {
  useEffect(() => keptSignIn(sessionStorage), [])
  return null
}
