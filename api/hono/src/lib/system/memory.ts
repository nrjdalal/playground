import {
  procReading,
  procSource,
  procUsedBytes,
  type SysctlName,
} from "@packages/scripts/src/ops-machine/readings"

import { parseSysctl, parseVmStat, type Sysctl } from "@/lib/system/parse"
import { probe } from "@/lib/system/probe"

const NAMES = [
  "kern.memorystatus_level",
  "kern.memorystatus_vm_pressure_level",
  "vm.swapusage",
] as const satisfies readonly SysctlName[]

type Read<T> = { read: Promise<T>; what: string }

// Linux's free share, pressure level and swap, each from its /proc file through ops-machine's readings seam in sysctl's shape; it throws when none reads.
async function procSysctl(): Promise<Sysctl> {
  const lines = NAMES.flatMap((name) => {
    const value = procReading(name)
    return value === null ? [] : [`${name}: ${value}`]
  })
  if (lines.length === 0) throw new Error("none of its memory readings read")
  return parseSysctl(lines.join("\n"))
}

async function procUsed(): Promise<number> {
  const used = procUsedBytes()
  if (used === null) throw new Error("MemTotal or MemAvailable does not read")
  return used
}

// The memory readings and what each is named by in problems: on Linux /proc alone, through ops-machine's readings seam, so no sysctl or vm_stat runs there; else macOS's sysctl and vm_stat, which a fixture stack answers from its fixture.
export function memoryReads(linux: boolean): {
  sysctl: Read<Sysctl>
  usedBytes: Read<number | null>
} {
  if (linux) {
    return {
      sysctl: { read: procSysctl(), what: [...new Set(NAMES.map(procSource))].join(" and ") },
      usedBytes: { read: procUsed(), what: "/proc/meminfo" },
    }
  }
  return {
    sysctl: { read: probe("sysctl").then(parseSysctl), what: "sysctl" },
    usedBytes: {
      read: probe("memory").then((out) => parseVmStat(out)?.usedBytes ?? null),
      what: "vm_stat",
    },
  }
}
