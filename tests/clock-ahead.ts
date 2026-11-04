// test-sandbox.ts preloads this when CLOCK_AHEAD_DAYS is set: Date runs on, that many days ahead, where bun's setSystemTime would stop it and every timed wait would read 0
const ahead = Number(process.env.CLOCK_AHEAD_DAYS) * 86_400_000
const RealDate = Date

// callable with new alone, as every Date in this repo is made
globalThis.Date = class extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + ahead)
    else super(...(args as [string]))
  }

  static override now() {
    return RealDate.now() + ahead
  }

  // a Date bun makes natively (a stat's mtime, a structuredClone) is a RealDate, which instanceof Date must still accept
  static [Symbol.hasInstance](value: unknown) {
    return value instanceof RealDate
  }
} as unknown as DateConstructor
