// The Inbox's accordion rows, which the Changelog lists its versions in too.

// Each row's header sticks to the top of the pane, up over its top padding (--pane-top) so no text shows above it, while its section scrolls under it, on the pane's own background, with a line between rows and none around the whole, running the pane's full width out over its side padding (--pane-x) so a band scrolling under a stuck header never shows at its sides.
export const STICKY_HEADER =
  "bg-background sticky top-[calc(var(--pane-top,0px)*-1)] z-10 -mx-(--pane-x) px-(--pane-x) after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border [:last-child:not([data-open])>&]:after:hidden"
// the open row's header also paints up over the pane's top padding, so no card text shows above it once it sticks; a shelf's would cover the row above it
export const OPEN_HEADER =
  "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-12 before:bg-background"
// The line sits under each row's header so it stays under a stuck header, the last row drawing none, and an open row draws one more after its section, so the next header reads as topped with a line.
export const SHELF_ITEM =
  "relative not-last:border-b-0 not-last:data-open:after:pointer-events-none not-last:data-open:after:absolute not-last:data-open:after:bottom-0 not-last:data-open:after:inset-x-[calc(var(--pane-x,0px)*-1)] not-last:data-open:after:h-px not-last:data-open:after:bg-border"

// One accordion row: small words on one line, no underline on hover, never wider than its column, so a long row truncates rather than clipping at the pane's edge, its own ShelfMark in place of the stock up and down chevrons
export const SHELF_ROW =
  "min-w-0 items-center py-2 text-xs font-normal hover:no-underline disabled:cursor-default disabled:opacity-50 [&>[data-slot=accordion-trigger-icon]]:hidden!"
