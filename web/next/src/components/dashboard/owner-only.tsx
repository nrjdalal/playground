import { RiLockLine } from "@remixicon/react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

// The dashboard's surfaces (its apps, its inbox) sit on its owner rung; the API refuses everyone else, and this says why instead of showing an error. Each surface names itself and why it needs the rung.
export function OwnerOnly({
  title = "Apps are for the owner",
  why = "They read every session's transcript",
}: {
  title?: string
  why?: string
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiLockLine />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          {why}, so they need the owner rung, which this Mac's owner holds.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
