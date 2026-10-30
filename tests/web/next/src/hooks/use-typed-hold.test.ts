import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TYPED_HOLD_MS } from "../../../../../web/next/src/lib/outbox"

// The web app builds every component and hook through the React Compiler (next.config.ts's reactCompiler), which keeps a value read in render for as long as its inputs stand. So the hook runs here as that build makes it: compiled by the same plugin, then rendered by a small stand-in for React's useState, useEffect and memo cache.
const web = join(import.meta.dir, "../../../../../web/next")
const source = join(web, "src/hooks/use-typed-hold.ts")
const plugin = Bun.resolveSync("babel-plugin-react-compiler", web)
const babel = (await import(Bun.resolveSync("@babel/core", import.meta.dir))) as {
  transformAsync: (code: string, options: object) => Promise<{ code: string }>
}
const typescript = Bun.resolveSync("@babel/plugin-syntax-typescript", import.meta.dir)

const REACT = `
let current = null
export function mount(hook, arg) {
  const inst = { caches: [], effects: [], pending: [], states: [] }
  inst.render = () => {
    current = inst
    inst.si = inst.ei = inst.ci = 0
    inst.value = hook(arg)
    current = null
    for (const e of inst.pending.splice(0)) {
      e.cleanup?.()
      e.cleanup = e.create() ?? undefined
    }
  }
  inst.render()
  return inst
}
export function useState(init) {
  const inst = current, i = inst.si++
  if (!(i in inst.states)) inst.states[i] = typeof init === "function" ? init() : init
  const set = (v) => {
    const next = typeof v === "function" ? v(inst.states[i]) : v
    if (Object.is(next, inst.states[i])) return
    inst.states[i] = next
    inst.render()
  }
  return [inst.states[i], set]
}
export function useEffect(create, deps) {
  const inst = current, i = inst.ei++
  const prev = inst.effects[i]
  if (prev && deps.every((d, k) => Object.is(d, prev.deps[k]))) return
  const e = prev ?? {}
  e.create = create
  e.deps = deps
  inst.effects[i] = e
  inst.pending.push(e)
}
export function c(n) {
  const inst = current, i = inst.ci++
  return (inst.caches[i] ??= Array.from({ length: n }, () => Symbol.for("react.memo_cache_sentinel")))
}
`

const dir = await mkdtemp(join(tmpdir(), "typed-hold-"))
afterAll(() => rm(dir, { force: true, recursive: true }))

const compiled = await babel.transformAsync(await Bun.file(source).text(), {
  babelrc: false,
  configFile: false,
  filename: source,
  plugins: [typescript, plugin],
})
const react = join(dir, "react.js")
await Bun.write(react, REACT)
await Bun.write(
  join(dir, "use-typed-hold.js"),
  new Bun.Transpiler({ loader: "ts" })
    .transformSync(compiled.code)
    .replaceAll(/"react(?:\/compiler-runtime)?"/g, JSON.stringify(react))
    .replaceAll('"@/lib/outbox"', JSON.stringify(join(web, "src/lib/outbox.ts"))),
)
const { mount } = (await import(react)) as {
  mount: (hook: (typedAt: string | null) => boolean, typedAt: string | null) => { value: boolean }
}
const { useTypedHold } = (await import(join(dir, "use-typed-hold.js"))) as {
  useTypedHold: (typedAt: string | null) => boolean
}

test("the hook runs as the React Compiler builds it, so the test reads its memo cache", () => {
  expect(compiled.code).toContain("react/compiler-runtime")
})

// A single sent take showed no Dismiss until a reload: the timer fired and re-rendered, but the compiled hook kept the hold it read in render, so Dismiss never came until a reload built the bubble anew.
test("a typed message holds Dismiss back, then offers it once the hold lifts", async () => {
  const hold = mount(useTypedHold, new Date().toISOString())
  expect(hold.value).toBe(false)
  await Bun.sleep(TYPED_HOLD_MS + 200)
  expect(hold.value).toBe(true)
})

// A timer can fire before its delay, so the hook re-arms while the bound is still ahead rather than lift early.
test("a timer that fires early leaves Dismiss held back until the hold has passed", async () => {
  const real = globalThis.setTimeout
  globalThis.setTimeout = ((fn: () => void, ms = 0) => real(fn, ms / 2)) as typeof setTimeout
  try {
    const hold = mount(useTypedHold, new Date().toISOString())
    await Bun.sleep(TYPED_HOLD_MS * 0.75)
    expect(hold.value).toBe(false)
    await Bun.sleep(TYPED_HOLD_MS * 0.25 + 200)
    expect(hold.value).toBe(true)
  } finally {
    globalThis.setTimeout = real
  }
})

test("a message typed past the hold offers Dismiss at once, and one it does not know holds nothing back", () => {
  expect(mount(useTypedHold, new Date(Date.now() - 5_000).toISOString()).value).toBe(true)
  expect(mount(useTypedHold, null).value).toBe(true)
})
