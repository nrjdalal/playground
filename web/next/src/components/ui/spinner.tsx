import {
  RiCheckboxBlankCircleFill,
  RiLoader4Line,
  type RemixiconComponentType,
} from "@remixicon/react"
import { cn } from "cn"

// The sidebar's working loader turning, in place of the pulsing dot that read as a stray mark at the top of the chat and the aside; still under reduced motion.
function Spinner({ className, ...props }: React.ComponentProps<RemixiconComponentType>) {
  return (
    <RiLoader4Line
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 motion-safe:animate-spin", className)}
      {...props}
    />
  )
}

// A pane's first load: the Spinner in the middle of the pane, both ways, over a positioned parent.
function CenterSpinner() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <Spinner />
    </div>
  )
}

// A session at work in the chat, its activity line and a running step: one dot pulsing on the System dot's timing, its size-3 look in a size-4 box, still under reduced motion, since a loader there would read as the page loading.
function PulseDot({ className, ...props }: React.ComponentProps<RemixiconComponentType>) {
  return (
    <RiCheckboxBlankCircleFill
      data-slot="pulse-dot"
      role="status"
      aria-label="Working"
      className={cn("size-4 scale-75 motion-safe:animate-pulse", className)}
      {...props}
    />
  )
}

export { CenterSpinner, PulseDot, Spinner }
