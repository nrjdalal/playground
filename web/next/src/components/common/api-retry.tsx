"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

const RETRY_SECONDS = 5

// What a page shows while its session read gets no answer, in place of next's error document: it counts down and reads again in place, so the page comes back once the API does.
export function ApiRetry() {
  const router = useRouter()
  const [left, setLeft] = useState(RETRY_SECONDS)

  useEffect(() => {
    const tick = setTimeout(() => {
      if (left > 1) return setLeft(left - 1)
      router.refresh()
      setLeft(RETRY_SECONDS)
    }, 1000)
    return () => clearTimeout(tick)
  }, [left, router])

  return (
    <Empty className="min-h-svh">
      <EmptyHeader>
        <EmptyTitle>Can't reach the API</EmptyTitle>
        <EmptyDescription>Retrying in {left}s</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
