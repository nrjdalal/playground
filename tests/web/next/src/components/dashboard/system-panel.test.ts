import { describe, expect, test } from "bun:test"

import {
  readingsOf,
  swapDetail,
} from "../../../../../../web/next/src/components/dashboard/system-panel"

type SystemReport = Parameters<typeof readingsOf>[0]

const GB = 1024 ** 3
const NOW = new Date("2026-11-16T12:00:00Z")

describe("swapDetail", () => {
  test("macOS keeps its line: it grows swap as it needs it", () => {
    expect(swapDetail("darwin")).toBe("macOS grows swap as it needs it")
  })

  test("Linux says its swap stays at a set size, never macOS's line", () => {
    expect(swapDetail("linux")).toBe("Linux keeps swap at a set size")
  })
})

describe("readingsOf", () => {
  const report = (machines: SystemReport["machines"]) =>
    ({
      cpu: { cores: 20, load: [3.1, 2.9, 2.5] },
      disk: { freeBytes: 700 * GB, totalBytes: 994 * GB },
      docker: { containers: [], problem: null, vmBytes: null },
      history: [],
      machines,
      memory: {
        freePercent: 90,
        pressure: "normal",
        swap: { totalBytes: 16 * GB, usedBytes: 1 * GB },
        totalBytes: 128 * GB,
        usedBytes: 12 * GB,
      },
      platform: "linux",
    }) as unknown as SystemReport
  const rows = (machines: SystemReport["machines"]) =>
    readingsOf(report(machines), NOW).map(({ detail, hover, id, value }) => ({
      detail,
      hover,
      id,
      value,
    }))

  test("with no peers configured, the table is this machine's own, as before, with no hover", () => {
    expect(rows([])).toEqual([
      {
        detail: "90% free · pressure Normal",
        hover: undefined,
        id: "memory",
        value: "12.0 GB of 128.0 GB",
      },
      {
        detail: "1, 5 and 15 min.: 3.1 / 2.9 / 2.5",
        hover: undefined,
        id: "cpu",
        value: "3.1 on 20 cores",
      },
      {
        detail: "Linux keeps swap at a set size",
        hover: undefined,
        id: "swap",
        value: "1.0 GB of 16.0 GB",
      },
      { detail: "of 994.0 GB", hover: undefined, id: "disk", value: "700.0 GB" },
      expect.objectContaining({ hover: undefined, id: "docker" }),
    ])
  })

  test("with a peer, memory, CPU load and swap show the cluster's sums with the split on hover, while disk and Docker stay this machine's", () => {
    const local = {
      cores: 20,
      load: [3.1, 2.9, 2.5] as [number, number, number],
      memory: { totalBytes: 128 * GB, usedBytes: 12 * GB },
      swap: { totalBytes: 16 * GB, usedBytes: 1 * GB },
    }
    const peer = { ...local, load: [0.4, 0.3, 0.2] as [number, number, number] }
    const shown = rows([
      { down: null, name: "spark-a566", reading: local },
      { down: null, name: "spark-9dfb", reading: peer },
    ])
    expect(shown.map((r) => [r.id, r.value, r.hover])).toEqual([
      [
        "memory",
        "24.0 GB of 256.0 GB",
        "spark-a566 12.0 GB of 128.0 GB + spark-9dfb 12.0 GB of 128.0 GB",
      ],
      ["cpu", "3.5 on 40 cores", "spark-a566 3.1 on 20 + spark-9dfb 0.4 on 20 cores"],
      ["swap", "2.0 GB of 32.0 GB", "spark-a566 1.0 GB of 16.0 GB + spark-9dfb 1.0 GB of 16.0 GB"],
      ["disk", "700.0 GB", undefined],
      ["docker", "-", undefined],
    ])
  })
})
