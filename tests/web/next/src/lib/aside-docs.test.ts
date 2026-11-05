import { describe, expect, test } from "bun:test"

import {
  closeDoc,
  docTab,
  fileDoc,
  openDoc,
  opensInAside,
  pageDoc,
} from "../../../../../web/next/src/lib/aside-docs"

const plan = fileDoc({ id: "a1", kind: "doc", name: "plan.md" })
const report = pageDoc("report-2.html", "Fixture report", "https://api.test/report-2.html")

describe("a page or a document opened in the aside", () => {
  test("opens in a tab of its own: two opens make two tabs, the second focused", () => {
    const first = openDoc([], plan)
    const second = openDoc(first.docs, report)
    expect(second.docs).toEqual([plan, report])
    expect(second.tab).toBe(docTab(report))
  })

  test("reopened, focuses its own tab and adds no third", () => {
    const open = openDoc(openDoc([], plan).docs, report).docs
    const again = openDoc(open, fileDoc({ id: "a1", kind: "doc", name: "plan.md" }))
    expect(again.docs).toHaveLength(2)
    expect(again.docs).toBe(open)
    expect(again.tab).toBe("doc:file-a1")
  })

  test("leaves the bar once its tab closes, the others kept in order", () => {
    expect(closeDoc([plan, report], docTab(plan))).toEqual([report])
  })

  test("is a card's page, markdown document or PDF; an image and a code file keep the full-screen viewer", () => {
    expect(["doc", "html", "pdf"].every((kind) => opensInAside(kind as "doc"))).toBe(true)
    expect(opensInAside("image")).toBe(false)
    expect(opensInAside("code")).toBe(false)
  })

  test("is keyed by its file's id or its page's name, so a page's title never splits it", () => {
    expect(docTab(report)).toBe("doc:page-report-2.html")
    expect(pageDoc("report-2.html", "Renamed", "https://api.test/report-2.html").key).toBe(
      report.key,
    )
  })
})
