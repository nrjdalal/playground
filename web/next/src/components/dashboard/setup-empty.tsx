import type { RemixiconComponentType } from "@remixicon/react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { Setup } from "@/lib/setup"

// An area with nothing to show on a stack reading its own machine: what is missing and how to set it up (lib/setup.ts), or nothing when no line fits.
export function SetupEmpty({
  icon: Icon,
  setup,
}: {
  icon?: RemixiconComponentType
  setup: Setup | null
}) {
  if (!setup) return null
  return (
    <Empty>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle>{setup.title}</EmptyTitle>
        <EmptyDescription>{setup.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
