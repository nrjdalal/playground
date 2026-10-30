import { RiArrowRightSLine, RiCircleLine } from "@remixicon/react"

// A shelf row's right end: a small circle on an empty shelf, else a chevron pointing right while closed and down while open, on a rounded square while the row is hovered.
export function ShelfMark({ empty = false }: { empty?: boolean }) {
  return (
    <span
      aria-hidden
      className="text-muted-foreground group-hover/accordion-trigger:group-enabled/accordion-trigger:bg-muted group-hover/accordion-trigger:group-enabled/accordion-trigger:text-foreground -my-1 -mr-1 ml-auto grid size-6 shrink-0 place-items-center rounded-md transition-colors"
    >
      {empty ? (
        <RiCircleLine className="size-2.5" />
      ) : (
        <RiArrowRightSLine className="size-4 transition-transform group-aria-expanded/accordion-trigger:rotate-90" />
      )}
    </span>
  )
}
