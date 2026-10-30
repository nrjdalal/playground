import { describe, expect, test } from "bun:test"

import { allowlistColumnConfig } from "../../../../../web/next/src/app/(console)/console/(access)/allowlist/components/data-columns"
import { usersColumnConfig } from "../../../../../web/next/src/app/(console)/console/(access)/users/components/data-columns"
import { activityColumnConfig } from "../../../../../web/next/src/app/(console)/console/activity/components/data-columns"
import { waitlistColumnConfig } from "../../../../../web/next/src/app/(console)/console/waitlist/components/data-columns"
import {
  usageAccountConfig,
  usagePrConfig,
  usageSpendConfig,
  usageWindowConfig,
} from "../../../../../web/next/src/app/(protected)/dashboard/apps/usage/components/usage-view"
import { sessionsColumnConfig } from "../../../../../web/next/src/app/(protected)/dashboard/sessions/components/data-columns"
import {
  applyColumnManager,
  type ColumnConfig,
  filtersFromUrl,
  firstSightings,
  urlFromFilters,
} from "../../../../../web/next/src/lib/data-table-layout"

describe("firstSightings", () => {
  test("a row a later page repeats stays where it was first seen, so no id shows twice", () => {
    const pages = [
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "b", n: 3 },
      { id: "c", n: 4 },
    ]
    expect(firstSightings(pages, (row) => row.id)).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "c", n: 4 },
    ])
  })
})

describe("default filters", () => {
  const defaults = { project: ["bugs"], status: ["todo"] }

  test("a URL that names no filter shows the defaults", () => {
    expect(filtersFromUrl({ project: null, status: null }, defaults)).toEqual([
      { id: "project", value: ["bugs"] },
      { id: "status", value: ["todo"] },
    ])
  })

  test("a URL's own values replace a default, and an empty one clears it", () => {
    expect(filtersFromUrl({ project: [], status: ["done"] }, defaults)).toEqual([
      { id: "status", value: ["done"] },
    ])
  })

  test("an id with no default and no values filters nothing", () => {
    expect(filtersFromUrl({ role: null }, {})).toEqual([])
    expect(filtersFromUrl({ role: [] }, {})).toEqual([])
  })

  test("the defaults themselves leave the URL clean, in any order", () => {
    const next = [
      { id: "project", value: ["bugs"] },
      { id: "status", value: ["todo"] },
    ]
    expect(urlFromFilters(next, ["project", "status"], defaults)).toEqual({
      project: null,
      status: null,
    })
    expect(
      urlFromFilters([{ id: "status", value: ["todo"] }], ["status"], { status: ["todo"] }),
    ).toEqual({ status: null })
  })

  test("clearing a defaulted facet writes it empty, so the default does not come back", () => {
    const url = urlFromFilters([{ id: "status", value: ["todo"] }], ["project", "status"], defaults)
    expect(url).toEqual({ project: [], status: null })
    expect(filtersFromUrl(url, defaults)).toEqual([{ id: "status", value: ["todo"] }])
  })

  test("a facet with no default is dropped from the URL when cleared", () => {
    expect(urlFromFilters([], ["role"], {})).toEqual({ role: null })
    expect(urlFromFilters([{ id: "role", value: ["admin"] }], ["role"], {})).toEqual({
      role: ["admin"],
    })
  })
})

describe("numeric columns", () => {
  const column = (id: string, meta?: { label?: string; numeric?: boolean }) => ({ id, meta })
  const metaOf = (columns: ReturnType<typeof applyColumnManager>, id: string) =>
    columns.find((c) => c.id === id)?.meta

  test("numeric right-aligns a column, and a plain one stays left", () => {
    const columns = applyColumnManager([column("cost"), column("name")], {
      cost: { numeric: true },
      name: {},
    })
    expect(metaOf(columns, "cost")).toMatchObject({ align: "right", numeric: true })
    expect(metaOf(columns, "name")).toMatchObject({ align: "left", numeric: false })
  })

  test("a column built numeric keeps it with no config of its own", () => {
    const columns = applyColumnManager([column("calls", { numeric: true })], {})
    expect(metaOf(columns, "calls")).toMatchObject({ align: "right", numeric: true })
  })

  test("an explicit align still wins over numeric's right", () => {
    const columns = applyColumnManager([column("n")], { n: { align: "center", numeric: true } })
    expect(metaOf(columns, "n")).toMatchObject({ align: "center", numeric: true })
  })
})

// Every number, count, time and money column in these tables says numeric, so it sits right in even digits; right alignment comes only from numeric, so a text column never drifts right and a number column never forgets its digits.
describe("the tables' number columns", () => {
  const tables: [string, Record<string, ColumnConfig>, string[]][] = [
    ["activity", activityColumnConfig, ["createdAt"]],
    ["allowlist", allowlistColumnConfig, ["createdAt"]],
    ["sessions", sessionsColumnConfig, ["cost", "entries", "lastActive"]],
    ["usage accounts", usageAccountConfig, ["fiveHour", "week"]],
    ["usage prs", usagePrConfig, ["build", "review", "rounds", "test", "tokens", "total", "wall"]],
    ["usage spend", usageSpendConfig, ["calls", "tokens", "usd"]],
    ["usage windows", usageWindowConfig, ["used"]],
    ["users", usersColumnConfig, ["createdAt", "lastActive"]],
    ["waitlist", waitlistColumnConfig, ["createdAt"]],
  ]

  for (const [name, config, numbers] of tables) {
    test(`${name}: its number columns are numeric`, () => {
      for (const id of numbers)
        expect({ id, numeric: config[id]?.numeric }).toEqual({ id, numeric: true })
    })

    test(`${name}: nothing is right-aligned but through numeric`, () => {
      const right = Object.entries(config).filter(([, entry]) => entry.align === "right")
      expect(right.map(([id]) => id)).toEqual([])
    })
  }
})
