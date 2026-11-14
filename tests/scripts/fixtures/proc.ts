import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// /proc's text in the Linux kernel's own formats (Documentation/filesystems/proc.rst and accounting/psi.rst), for the machine readings' Linux branch on a Mac: a test writes it with procDir, points PLAYGROUND_PROC at the folder under the test sandbox (TEST_SANDBOX_HOME), and leaves the macOS command each reading takes first unread.
export type Proc = {
  // the cpu<n> lines in /proc/stat
  cores?: number
  // MemAvailable's share of MemTotal, in percent
  free?: number
  // PSI's full avg10 for memory, in percent
  full?: number
  // the CPU's idle share between the two /proc/stat reads, in percent
  idle?: number
  load1?: number
  load5?: number
  // PSI's some avg10 for memory, in percent
  some?: number
  // pswpin's rise between the two /proc/vmstat reads
  swapins?: number
  // SwapTotal less SwapFree, in MB
  swapUsedMB?: number
}

const TOTAL_KB = 128 * 1024 * 1024
const PSWPIN = 4_049_933

// Each file's first read, as the kernel prints it.
const cpus = (cores: number) =>
  Array.from({ length: cores }, (_, n) => `cpu${n} 5000 10 2500 42500 50 0 15 0 0 0\n`).join("")

export const procText = ({
  cores = 20,
  free = 50,
  full = 0,
  load1 = 1.25,
  load5 = 2.5,
  some = 0,
  swapUsedMB = 0,
}: Proc = {}): Record<string, string> => ({
  loadavg: `${load1.toFixed(2)} ${load5.toFixed(2)} 3.00 2/1834 99120\n`,
  meminfo: [
    `MemTotal:       ${TOTAL_KB} kB`,
    `MemFree:        ${Math.floor(TOTAL_KB / 10)} kB`,
    `MemAvailable:   ${Math.floor((TOTAL_KB * free) / 100)} kB`,
    "Buffers:          482112 kB",
    "Cached:         40123456 kB",
    "SwapCached:            0 kB",
    "SwapTotal:      16777212 kB",
    `SwapFree:       ${16_777_212 - swapUsedMB * 1024} kB`,
    "",
  ].join("\n"),
  "pressure/memory": `some avg10=${some.toFixed(2)} avg60=0.00 avg300=0.00 total=1200\nfull avg10=${full.toFixed(2)} avg60=0.00 avg300=0.00 total=300\n`,
  stat: `cpu  100000 200 50000 850000 1000 0 300 0 0 0\n${cpus(cores)}intr 123456\nctxt 7890123\nbtime 1763100000\nprocesses 99120\n`,
  vmstat: `nr_free_pages 3276800\npgpgin 123456\npswpin ${PSWPIN}\npswpout 116968\n`,
})

// The second read's text, 1000 jiffies of CPU on and `swapins` more pages swapped in.
export const laterText = ({ cores = 20, idle = 60, swapins = 0 }: Proc = {}): Record<
  string,
  string
> => ({
  stat: `cpu  ${101000 - Math.round(idle * 10)} 200 50000 ${850000 + Math.round(idle * 10)} 1000 0 300 0 0 0\n${cpus(cores)}btime 1763100000\n`,
  vmstat: `nr_free_pages 3276800\npgpgin 123456\npswpin ${PSWPIN + swapins}\npswpout 116968\n`,
})

// A folder of /proc text for `proc`, with each name in `omit` left out. `later` lists the second reads in the order the readings take them: the fake sleep moves later/1's files in, then later/2's.
export const procDir = (proc: Proc = {}, omit: string[] = [], later: string[][] = []): string => {
  const dir = mkdtempSync(join(tmpdir(), "proc-"))
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  for (const [name, text] of Object.entries(procText(proc)))
    if (!omit.includes(name)) write(join(dir, name), text)
  later.forEach((names, i) => {
    const text = laterText(proc)
    for (const name of names) write(join(dir, "later", String(i + 1), name), text[name]!)
  })
  return dir
}

// A fake sleep for the bin folder a test puts first on PATH: it moves the next later/<n> folder's files over the /proc text, then sleeps as the real one does, so a two-read reading sees the second text.
export const FAKE_SLEEP = `#!/bin/bash
if [ -n "$PLAYGROUND_PROC" ]; then
  for d in "$PLAYGROUND_PROC"/later/*/; do
    [ -d "$d" ] || break
    mv "$d"* "$PLAYGROUND_PROC"/ && rmdir "$d"
    break
  done
fi
exec /bin/sleep "$@"
`
