// One glass for everything that floats over a page or a picture: every floating bar, the aside's tab squares, the table's selection actions and the viewer's bar, and every tooltip (the owner on #i949: "one glass, one way to light a control", "All should be the same kind of liquid glass").
export const GLASS = "bg-popover/60 border-border border shadow-md backdrop-blur-md"

// The bar that floats over a pane's bottom edge, one look for the table's selection actions, the aside's tab squares and the viewer's bar; its row sits pointer-events-none, so the bar alone takes clicks.
export const FLOATING_BAR = `${GLASS} pointer-events-auto flex items-center gap-1 rounded-md p-1`

// A square or button inside a floating bar, borderless, lit the same light lift on hover, keyboard focus, pressed and chosen, with no ring.
export const BAR_ITEM =
  "border-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 hover:bg-foreground/10 focus-visible:bg-foreground/10 aria-pressed:bg-foreground/10 data-active:bg-foreground/10 data-pressed:bg-foreground/10 dark:hover:bg-foreground/10 dark:data-active:bg-foreground/10"
