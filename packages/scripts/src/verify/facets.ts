import type { Browser, Result, Target, Viewport } from "./checks"

// The page whose faceted filters it opens, through the one FacetedFilter in web/next/src/components/data-table.tsx: the Changelog draws a count beside each pick (after `bun run changelog fixture` on a fixture stack).
export const FACET_ROUTES = ["/dashboard/apps/changelog"]
// A pixel for rounding.
const SLACK = 1
const SETTLE_MS = 300

// One open facet: its title and the right edge of every count it shows, in pixels from the viewport's left.
export type FacetMeasure = { facet: string; rights: number[] }

// Pure: every facet's counts end at one x, so they read as one right-aligned column (the stock check icon, hidden but still ml-auto, split the row's free space with the count).
export const facetResult = (check: string, facets: FacetMeasure[]): Result => {
  if (!facets.length) return { check, detail: "found no faceted filter", ok: false }
  for (const { facet, rights } of facets) {
    const spread = Math.round(Math.max(...rights) - Math.min(...rights))
    if (spread > SLACK)
      return { check, detail: `${facet}'s counts end ${spread}px apart`, ok: false }
  }
  const compared = facets.filter(({ rights }) => rights.length > 1)
  if (!compared.length) return { check, detail: "no facet shows two counts to compare", ok: false }
  return {
    check,
    detail: `counts line up in ${compared.map(({ facet }) => facet).join(", ")}`,
    ok: true,
  }
}

const TRIGGERS = `[data-slot="popover-trigger"].border-dashed`

// The open facet's counts: in each item, the last child that is not an icon and holds only digits.
const MEASURE = `(() => { const items = [...document.querySelectorAll('[data-slot="popover-content"] [data-slot="command-item"]')]; return items.map((item) => [...item.children].filter((child) => child.tagName.toLowerCase() !== "svg").at(-1)).filter((child) => child && /^\\d+$/.test(child.textContent.trim())).map((child) => child.getBoundingClientRect().right) })()`

// At the viewport, on each route, opens every faceted filter in turn, reads where its counts end, and closes it; it picks nothing.
export const facets = async (
  browser: Browser,
  { web }: Target,
  viewport: Viewport,
): Promise<Result[]> => {
  await browser.viewport(viewport)
  const results: Result[] = []
  for (const route of FACET_ROUTES) {
    await browser.visit(`${web}${route}`)
    const titles = await browser.eval<string[]>(
      `[...document.querySelectorAll('${TRIGGERS}')].map((button, i) => { button.dataset.verifyFacet = String(i); return button.textContent.trim() })`,
    )
    const measured: FacetMeasure[] = []
    for (const [i, facet] of titles.entries()) {
      await browser.run("click", `[data-verify-facet="${i}"]`)
      await browser.run("wait", String(SETTLE_MS))
      measured.push({ facet, rights: await browser.eval<number[]>(MEASURE) })
      await browser.run("press", "Escape")
      await browser.run("wait", String(SETTLE_MS))
    }
    results.push(facetResult(`facets ${viewport.width} ${route}`, measured))
  }
  return results
}
