import { Node, Project, SyntaxKind } from "ts-morph"

// Re-applies every local override after `shadcn-update.sh` wipes ui/ and re-scaffolds the app.
// Two strategies:
//   restore, files we own outright; shadcn's version carries nothing we want, so reset to HEAD.
//   patch  , registry components we extend; ts-morph locates the TSX nodes by shape (not text) so
//             attribute/param reordering can't break them; the globals.css values are guarded
//             string swaps (stable lines aren't worth a CSS parser).
// Each patch is idempotent and throws if its target is absent, so a shadcn shape change fails the
// sync loudly instead of silently dropping an override. A single oxfmt pass runs after.

const log = (msg: string) => console.log(`[shadcn-customize] ${msg}`)

const UI = "web/next/src/components/ui"
const BUTTON = `${UI}/button.tsx`
const CHECKBOX = `${UI}/checkbox.tsx`
const SIDEBAR = `${UI}/sidebar.tsx`
const GLOBALS = "web/next/src/app/globals.css"

// init/add re-scaffold these with shadcn defaults we keep none of: a next/font/google layout, a stripped utils.ts, catalog->pinned dep drift in web/next/package.json and bun.lock, and registry-declared deps nothing imports added to the root catalog (calendar's date-fns). Reset to HEAD; a dep a component really needs fails check-types and is bumped by hand. The spinner is ours whole: Remix's RiLoader4Line turning, beside CenterSpinner and PulseDot, none of which shadcn ships.
export const RESTORE = [
  "bun.lock",
  "package.json",
  "web/next/package.json",
  "web/next/src/app/layout.tsx",
  `${UI}/spinner.tsx`,
  "web/next/src/lib/utils.ts",
]

function restore() {
  const run = Bun.spawnSync(["git", "checkout", "HEAD", "--", ...RESTORE], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  if (run.exitCode !== 0) throw new Error(`shadcn-customize: git checkout exited ${run.exitCode}`)
  log(`restored from HEAD: ${RESTORE.join(", ")}`)
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
})

// button.tsx: Base UI render wiring (registry ships a plain native button).
function patchButton() {
  const sf = project.addSourceFileAtPath(BUTTON)
  const binding = sf.getFunctionOrThrow("Button").getParameters()[0]?.getNameNode()
  if (!binding || !Node.isObjectBindingPattern(binding))
    throw new Error(
      "shadcn-customize: Button params are not an object pattern; shadcn shape changed",
    )
  if (!binding.getElements().some((e) => e.getName() === "render")) {
    if (!binding.getElements().some((e) => e.getDotDotDotToken()))
      throw new Error("shadcn-customize: no `...props` rest in Button params; shape changed")
    binding.replaceWithText(binding.getText().replace("...props", "render, ...props"))
  }

  const el =
    sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).find(isButtonPrimitive) ??
    sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).find(isButtonPrimitive)
  if (!el)
    throw new Error("shadcn-customize: <ButtonPrimitive> not found in button.tsx; shape changed")
  const add = []
  if (!el.getAttribute("nativeButton")) add.push({ name: "nativeButton", initializer: "{!render}" })
  if (!el.getAttribute("render")) add.push({ name: "render", initializer: "{render}" })
  if (add.length) {
    // keep our explicit attrs before `{...props}`, exactly as the committed file has them
    const spread = el.getAttributes().findIndex((a) => Node.isJsxSpreadAttribute(a))
    el.insertAttributes(spread === -1 ? el.getAttributes().length : spread, add)
  }
  sf.saveSync()
  log(`patched: ${BUTTON}`)
}

function isButtonPrimitive(el: { getTagNameNode(): { getText(): string } }) {
  return el.getTagNameNode().getText() === "ButtonPrimitive"
}

// checkbox.tsx: indeterminate. Base UI renders the indicator for checked OR indeterminate but sets data-indeterminate (never data-checked), so the registry's check-only indicator paints a partial selection as a check on an unfilled box; fill the box and swap the glyph to a minus. Both keyed off the data attribute rather than the prop, since Base UI also derives the state itself for a parent checkbox in a CheckboxGroup, where the prop is undefined.
const INDETERMINATE_CLASSES =
  "data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-indeterminate:bg-primary"
const INDETERMINATE_ICON =
  '<>\n<RiCheckLine className="in-data-indeterminate:hidden" />\n<RiSubtractLine className="hidden in-data-indeterminate:block" />\n</>'

function patchCheckbox() {
  const sf = project.addSourceFileAtPath(CHECKBOX)
  const imp = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === "@remixicon/react")
  if (!imp)
    throw new Error(
      "shadcn-customize: @remixicon/react import not found in checkbox.tsx; shape changed",
    )
  if (!imp.getNamedImports().some((n) => n.getName() === "RiSubtractLine"))
    imp.addNamedImport({ name: "RiSubtractLine" })

  const root = sf
    .getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
    .find((el) => el.getTagNameNode().getText() === "CheckboxPrimitive.Root")
  if (!root)
    throw new Error(
      "shadcn-customize: <CheckboxPrimitive.Root> not found in checkbox.tsx; shape changed",
    )
  const classes = root
    .getAttribute("className")
    ?.getFirstDescendantByKind(SyntaxKind.CallExpression)
    ?.getArguments()[0]
  if (!classes || !Node.isStringLiteral(classes))
    throw new Error(
      'shadcn-customize: CheckboxPrimitive.Root className is not cn("..."); shape changed',
    )
  if (!classes.getLiteralValue().includes("data-indeterminate:bg-primary"))
    classes.setLiteralValue(`${classes.getLiteralValue()} ${INDETERMINATE_CLASSES}`)

  // the swapped-in markup still contains <RiCheckLine />, so check for the patch before the target
  if (!sf.getFullText().includes("in-data-indeterminate:")) {
    const icon = sf
      .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      .find((el) => el.getTagNameNode().getText() === "RiCheckLine")
    if (!icon)
      throw new Error("shadcn-customize: <RiCheckLine /> not found in checkbox.tsx; shape changed")
    icon.replaceWithText(INDETERMINATE_ICON)
  }
  sf.saveSync()
  log(`patched: ${CHECKBOX}`)
}

// button.tsx and toggle.tsx `sm`, and calendar.tsx's weekday and week-number cells, ship 12.8px text; the app's type scale is 16, 14, 12 and 10, so each takes text-xs.
export const SMALL_TEXT = [BUTTON, `${UI}/calendar.tsx`, `${UI}/toggle.tsx`]

export function smallText(source: string, file: string): string {
  const patched = source.replaceAll("text-[0.8rem]", "text-xs")
  const off = /text-\[[\d.]+(?:rem|px)\]/.exec(patched)
  if (off)
    throw new Error(`shadcn-customize: ${off[0]} in ${file} is off the type scale; shape changed`)
  return patched
}

async function patchSmallText() {
  for (const file of SMALL_TEXT) {
    await Bun.write(file, smallText(await Bun.file(file).text(), file))
    log(`patched: ${file}`)
  }
}

// The menu, select, combobox and command items ship cursor-default, which beats the base layer's pointer (the owner's rule: buttons and the other clickable places take a pointer cursor), so each takes cursor-pointer; idempotent, and it throws when a file holds neither.
export const POINTER_ITEMS = [
  `${UI}/combobox.tsx`,
  `${UI}/command.tsx`,
  `${UI}/context-menu.tsx`,
  `${UI}/dropdown-menu.tsx`,
  `${UI}/menubar.tsx`,
  `${UI}/select.tsx`,
]

export function pointerItems(source: string, file: string): string {
  const patched = source.replaceAll("cursor-default", "cursor-pointer")
  if (!patched.includes("cursor-pointer"))
    throw new Error(`shadcn-customize: no item cursor in ${file}; shape changed`)
  return patched
}

async function patchPointerItems() {
  for (const file of POINTER_ITEMS) {
    await Bun.write(file, pointerItems(await Bun.file(file).text(), file))
    log(`patched: ${file}`)
  }
}

// tooltip.tsx: the popup takes the floating bars' glass, the popover's colour at 60% with a border, a shadow and a blur, its text the foreground's, and loses its arrow, so every tooltip matches the bars it points from (the owner on #i949: "glass tooltip"); idempotent, and it throws when the popup changes shape.
export const TOOLTIP = `${UI}/tooltip.tsx`
const TOOLTIP_SOLID = "bg-foreground px-3 py-1.5 text-xs text-background"
export const TOOLTIP_GLASS =
  "border border-border bg-popover/60 px-3 py-1.5 text-xs text-foreground shadow-md backdrop-blur-md"

export function glassTooltip(source: string): string {
  const patched = source
    .replace(TOOLTIP_SOLID, TOOLTIP_GLASS)
    .replace(/\n\s*<TooltipPrimitive\.Arrow[^>]*\/>/, "")
  if (!patched.includes(TOOLTIP_GLASS))
    throw new Error(`shadcn-customize: tooltip popup not found in ${TOOLTIP}; shape changed`)
  return patched
}

// kbd.tsx: a key inside a tooltip keeps its own muted look, since its inverted one (the background's colour as text) vanishes on the glass popup; idempotent.
export const KBD = `${UI}/kbd.tsx`
export const plainKbd = (source: string): string =>
  source.replace(/ (dark:)?in-data-\[slot=tooltip-content\]:\S+/g, "")

async function patchTooltip() {
  await Bun.write(TOOLTIP, glassTooltip(await Bun.file(TOOLTIP).text()))
  await Bun.write(KBD, plainKbd(await Bun.file(KBD).text()))
  log(`patched: ${TOOLTIP}, ${KBD}`)
}

// accordion.tsx: AccordionTrigger's header is Base UI's h3 alone, so it takes a `header` render (`header={<h4 />}`) where the outline puts its title a level down, as the Pull requests tab's sections under the dashboard's own queue; idempotent, and it throws when the trigger changes shape.
export const ACCORDION = `${UI}/accordion.tsx`
const TRIGGER_PARAMS =
  /function AccordionTrigger\(\{\s*className,\s*children,\s*\.\.\.props\s*\}: AccordionPrimitive\.Trigger\.Props\)/
const HEADER = '<AccordionPrimitive.Header className="flex">'

export function accordionHeader(source: string): string {
  if (source.includes("render={header}")) return source
  if (!TRIGGER_PARAMS.test(source) || !source.includes(HEADER))
    throw new Error(
      `shadcn-customize: AccordionTrigger in ${ACCORDION} has no header to patch; shape changed`,
    )
  return source
    .replace(
      TRIGGER_PARAMS,
      'function AccordionTrigger({ className, children, header, ...props }: AccordionPrimitive.Trigger.Props & { header?: AccordionPrimitive.Header.Props["render"] })',
    )
    .replace(HEADER, '<AccordionPrimitive.Header className="flex" render={header}>')
}

async function patchAccordion() {
  await Bun.write(ACCORDION, accordionHeader(await Bun.file(ACCORDION).text()))
  log(`patched: ${ACCORDION}`)
}

// toast.tsx: its loading icon is RiLoader4Line, the app's one loader (the owner: "user loader4 instead of loader app wide"), where the registry ships RiLoaderLine; idempotent, and it throws when the toast has neither.
export const TOAST = `${UI}/toast.tsx`

export function loader4(source: string): string {
  if (!source.includes("RiLoaderLine") && !source.includes("RiLoader4Line"))
    throw new Error(`shadcn-customize: no loader icon in ${TOAST}; shape changed`)
  return source.replaceAll("RiLoaderLine", "RiLoader4Line")
}

async function patchToast() {
  await Bun.write(TOAST, loader4(await Bun.file(TOAST).text()))
  log(`patched: ${TOAST}`)
}

// sidebar.tsx: SidebarTrigger gains an optional children label, and SidebarRail drops its native title, since every hover is shadcn's Tooltip (the owner's rule: a tooltip everywhere instead of the default), which SidebarToggleRail puts on the rail.
function patchSidebar() {
  const sf = project.addSourceFileAtPath(SIDEBAR)
  const binding = sf.getFunctionOrThrow("SidebarTrigger").getParameters()[0]?.getNameNode()
  if (!binding || !Node.isObjectBindingPattern(binding))
    throw new Error(
      "shadcn-customize: SidebarTrigger params are not an object pattern; shape changed",
    )
  if (!binding.getElements().some((e) => e.getName() === "children")) {
    if (!binding.getElements().some((e) => e.getDotDotDotToken()))
      throw new Error(
        "shadcn-customize: no `...props` rest in SidebarTrigger params; shape changed",
      )
    binding.replaceWithText(binding.getText().replace("...props", "children, ...props"))
  }

  const icon = sf
    .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
    .find((el) => el.getTagNameNode().getText() === "RiSideBarLine")
  if (!icon)
    throw new Error("shadcn-customize: <RiSideBarLine /> not found in sidebar.tsx; shape changed")
  const already = icon
    .getParentIfKind(SyntaxKind.JsxElement)
    ?.getJsxChildren()
    .some((c) => Node.isJsxExpression(c) && c.getExpression()?.getText() === "children")
  if (!already) sf.insertText(icon.getEnd(), "\n{children}")

  sf.getFunctionOrThrow("SidebarRail")
    .getDescendantsOfKind(SyntaxKind.JsxAttribute)
    .find((a) => a.getNameNode().getText() === "title")
    ?.remove()
  sf.saveSync()
  log(`patched: ${SIDEBAR}`)
}

// globals.css: no visible scrollbars (the owner asked them gone), added to the base layer's `*` rule that init writes; idempotent, and it throws when that rule's shape changes.
export const SCROLLBARS_HIDDEN = `    scrollbar-width: none !important;
  }
  *::-webkit-scrollbar {
    display: none;
  }`

export function hideScrollbars(css: string): string {
  if (css.includes(SCROLLBARS_HIDDEN)) return css
  const anchor = /(@layer base \{\n  \* \{\n    @apply border-border outline-ring\/50;\n)  \}/
  if (!anchor.test(css))
    throw new Error(
      "shadcn-customize: the base layer's * rule not found in globals.css; shape changed",
    )
  return css.replace(anchor, `$1${SCROLLBARS_HIDDEN}`)
}

// globals.css: no focus ring anywhere, unlayered so it outranks every ring utility; the outline goes, but for forced-colors mode, which paints no shadow (a transparent outline instead flashed as transition-all faded it); appended once, idempotent.
export const NO_FOCUS_RING = `/* no focus ring anywhere, an invalid field's included: a focused or invalid control, or the field wrapping it, highlights its border alone; unlayered, so it outranks every ring utility */
:focus-visible,
[aria-invalid="true"],
[data-slot="input-group"]:has([aria-invalid="true"]),
[data-focused="true"] [data-day],
[data-slot="attachment"]:focus-within,
[data-slot="code-block"]:has(:focus-visible),
[data-slot="combobox-chips"]:focus-within,
[data-slot="input-group"]:has(:focus-visible),
[data-slot="item"]:has(a:focus-visible),
[data-slot="resizable-handle"]:focus-visible > div,
label:has(> [data-slot="questionnaire-choice-input"]:focus-visible) {
  --tw-ring-offset-shadow: 0 0 #0000;
  --tw-ring-shadow: 0 0 #0000;
}
:focus-visible {
  outline: none;
}
@media (forced-colors: active) {
  :focus-visible {
    outline: 2px solid;
  }
}
`

export function noFocusRing(css: string): string {
  return css.includes(NO_FOCUS_RING) ? css : `${css}\n${NO_FOCUS_RING}`
}

// globals.css: with no ring, a focused control that has no fill of its own takes a muted one, in the base layer so a component's own fill still wins (a field's border lights instead), while a focused pane tints and the resize handle lights, unlayered past their own fills; appended once, idempotent.
export const FOCUS_MARKS = `/* a focus mark without a ring: a focused control with no fill of its own takes a muted one, the base layer letting a component's own fill win; a valid control asking for focus-visible:border-ring gets it over a dark: border, and a control whose own fill is the muted one deepens it */
@layer base {
  :focus-visible {
    background-color: var(--muted);
  }
}
[data-slot="message-scroller-viewport"]:focus-visible,
[data-slot="tabs-content"]:focus-visible {
  background-color: color-mix(in oklab, var(--foreground) 4%, transparent);
}
[data-slot="resizable-handle"]:focus-visible {
  background-color: var(--ring);
}
[class~="focus-visible:border-ring"]:focus-visible:not([aria-invalid="true"]) {
  border-color: var(--ring);
}
[data-slot="needs-you-body"]:focus-visible,
[data-slot="sidebar-menu-button"][data-active]:focus-visible,
[data-slot="sidebar-menu-sub-button"][data-active]:focus-visible,
[role="tab"][data-active]:focus-visible {
  background-color: color-mix(in oklab, var(--foreground) 12%, var(--muted));
}
`

export function focusMarks(css: string): string {
  return css.includes(FOCUS_MARKS) ? css : `${css}\n${FOCUS_MARKS}`
}

// globals.css: every clickable control shows the pointer, and a plain disabled one not-allowed, in the base layer so a component's own cursor (the rail's resize, a board card's grab) still wins; idempotent, and it throws when body's rule changes shape.
export const BODY = `  body {
    @apply bg-background text-foreground;
  }`

export const POINTER_CURSORS = `${BODY}
  :is(
    a[href],
    button,
    label[for],
    select,
    summary,
    [role="button"],
    [role="checkbox"],
    [role="menuitem"],
    [role="menuitemcheckbox"],
    [role="menuitemradio"],
    [role="option"],
    [role="radio"],
    [role="switch"],
    [role="tab"]
  ) {
    cursor: pointer;
    &:is(:disabled, [aria-disabled="true"], [data-disabled]:not([data-disabled="false"])) {
      cursor: not-allowed;
    }
  }`

export function pointerCursors(css: string): string {
  if (css.includes(POINTER_CURSORS)) return css
  if (!css.includes(BODY))
    throw new Error(
      "shadcn-customize: the base layer's body rule not found in globals.css; shape changed",
    )
  return css.replace(BODY, POINTER_CURSORS)
}

// globals.css: --destructive is a status colour, Tailwind's red-600 in :root and red-500 in .dark, where init writes its own values; idempotent, and it throws when the two lines are not there.
export function destructiveShades(css: string): string {
  const line = /^(\s*)--destructive: .+;$/gm
  const found = css.match(line)
  if (!found || found.length !== 2)
    throw new Error(
      `shadcn-customize: expected 2 --destructive lines in globals.css, found ${found ? found.length : 0}; shape changed`,
    )
  let seen = 0
  return css.replace(
    line,
    (_, indent: string) => `${indent}--destructive: var(--color-red-${seen++ === 0 ? 600 : 500});`,
  )
}

// globals.css: the overrides init reverts, each a guarded swap on stable, uniquely-anchored lines: --font-sans at the DM Sans variable, both --sidebar lines flushed to --background, the hidden scrollbars, --destructive's shades and the pointer cursor rule.
async function patchGlobals() {
  let css = await Bun.file(GLOBALS).text()

  const FONT_FROM = "--font-sans: var(--font-sans);"
  const FONT_TO = "--font-sans: var(--font-dm-sans), sans-serif;"
  if (css.includes(FONT_FROM)) css = css.replace(FONT_FROM, FONT_TO)
  else if (!css.includes(FONT_TO))
    throw new Error("shadcn-customize: --font-sans anchor not found in globals.css; shape changed")

  // one --sidebar line in :root, one in .dark; both flush to --background regardless of the default
  const SIDEBAR_LINE = /^(\s*)--sidebar: .+;$/gm
  const sidebarLines = css.match(SIDEBAR_LINE)
  if (!sidebarLines || sidebarLines.length !== 2)
    throw new Error(
      `shadcn-customize: expected 2 --sidebar lines in globals.css, found ${sidebarLines ? sidebarLines.length : 0}; shape changed`,
    )
  css = css.replace(SIDEBAR_LINE, "$1--sidebar: var(--background);")
  css = hideScrollbars(css)
  css = destructiveShades(css)
  css = pointerCursors(css)
  css = noFocusRing(css)
  css = focusMarks(css)

  await Bun.write(GLOBALS, css)
  log(`patched: ${GLOBALS}`)
}

if (import.meta.main) {
  restore()
  await patchAccordion()
  patchButton()
  patchCheckbox()
  patchSidebar()
  await patchSmallText()
  await patchPointerItems()
  await patchToast()
  await patchTooltip()
  await patchGlobals()
}
