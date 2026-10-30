import type { RemixiconComponentType } from "@remixicon/react"
import { cn } from "cn"
import type { ReactNode } from "react"

import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"

// AI Elements' Checkpoint, the Dashboard's one marker line with an action, composed from the stock Marker with no rule beside it: a small icon, a few words and xs actions on one centred line as tall as its buttons at every width, so nothing below it moves when a button comes or goes, its content shrinking so a narrow pane never scrolls sideways; `className` lays out its content, as a bar that splits it to both edges passes `w-full justify-between`
export function Checkpoint({
  children,
  className,
  icon: Icon,
}: {
  children?: ReactNode
  className?: string
  icon?: RemixiconComponentType
}) {
  return (
    <Marker className="h-7 justify-center">
      {Icon && (
        <MarkerIcon>
          <Icon />
        </MarkerIcon>
      )}
      <MarkerContent className={cn("inline-flex items-center gap-2", className)}>
        {children}
      </MarkerContent>
    </Marker>
  )
}
