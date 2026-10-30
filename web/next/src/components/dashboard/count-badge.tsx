import { cn } from "cn"

// A count, capped where the corner dot stops reading cleanly.
export const countLabel = (count: number) => (count > 99 ? "99+" : String(count))

// Pure: a square's one corner mark: its count while it has one, else the plain dot while something there is new.
export const cornerMarks = (count: number, isNew: boolean) => ({
  count: count > 0,
  dot: isNew && count === 0,
})

// The one corner mark every square in the aside's tab bar wears, the app squares included: a red dot at the square's top right, outside the flow and never taken for content, holding the count when there is one and growing leftward past one digit from a fixed right edge; the plain dot shares a one-digit count's centre, so nothing in the square moves as a count comes, changes or goes.
export function CountBadge({ count }: { count?: number }) {
  return (
    <span
      aria-hidden
      data-slot="count-badge"
      className={cn(
        "bg-destructive pointer-events-none absolute rounded-full",
        count
          ? "text-2xs -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center px-0.5 font-mono leading-none text-white tabular-nums"
          : "-top-px -right-px size-2",
      )}
    >
      {count ? countLabel(count) : null}
    </span>
  )
}
