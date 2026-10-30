// A schedule in plain words for the sidebar's and the System page's runner rows: a job's `schedule` field or a runner's roster entry turned into "Every 5 min" or "Every day at 5:00 AM". No cron library: only the forms the reader knows are turned, and anything else comes back as written, so a cron it cannot read never reads as a wrong schedule.

export type Schedule = { always?: boolean; cron?: string; every?: number }

// machineUtcOffsetMinutes: the machine's UTC offset, since a cron's clock time is machine wall time; left out, the runtime's own zone stands in, which on the loopback-only dashboard is the machine's, so the option is a test seam. zone: the viewer's own, left out for Intl's default, so the browser shows its own time.
export type ScheduleWordsOptions = { machineUtcOffsetMinutes?: number; zone?: string }

// The schedule's words, or the cron as written when its form is not one of the reader's; a clock time reads today's date and, unless opts give it, the runtime's zone.
export function scheduleWords(schedule: Schedule, opts: ScheduleWordsOptions = {}): string {
  if (schedule.always) return "Always running"
  if (schedule.every && schedule.every > 0) return everyWords(schedule.every)
  if (schedule.cron) return cronWords(schedule.cron, opts)
  return "Unscheduled"
}

const everyWords = (seconds: number): string => {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600
    return hours === 1 ? "Every hour" : `Every ${hours} hours`
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? "Every minute" : `Every ${minutes} min`
  }
  return `Every ${seconds} sec`
}

const wholeNumber = (field: string, max: number): number | null => {
  if (!/^\d{1,2}$/.test(field)) return null
  const n = Number(field)
  return n <= max ? n : null
}

// An `n` in `*/n`, capped at the field's own range so an unreadable step shows as written.
const stepOf = (field: string, max: number): number | null => {
  const step = /^\*\/(\d+)$/.exec(field)
  if (!step) return null
  const n = Number(step[1])
  return n > 0 && n <= max ? n : null
}

// The moment a cron's clock time lands on, as machine wall time: today, or the next date whose machine weekday the cron's day-of-week names.
const momentFor = (
  minute: number,
  hour: number,
  dayOfWeek: number | null,
  opts: ScheduleWordsOptions,
): Date => {
  const offset = opts.machineUtcOffsetMinutes ?? -new Date().getTimezoneOffset()
  const wall = new Date(Date.now() + offset * 60000)
  const shift = dayOfWeek === null ? 0 : (dayOfWeek - wall.getUTCDay() + 7) % 7
  const day = new Date(wall.getTime() + shift * 86400000)
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute) -
      offset * 60000,
  )
}

// The clock time in the viewer's zone, spelled the table's way.
const clockWords = (moment: Date, opts: ScheduleWordsOptions): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(opts.zone && { timeZone: opts.zone }),
  }).format(moment)

// The cron day's name where the moment lands for the viewer, which a zone apart can shift a day.
const weekdayWords = (moment: Date, opts: ScheduleWordsOptions): string =>
  `${new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    ...(opts.zone && { timeZone: opts.zone }),
  }).format(moment)}s`

const cronWords = (cron: string, opts: ScheduleWordsOptions): string => {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return cron
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (dayOfMonth !== "*" || month !== "*") return cron
  if (hour === "*") {
    if (minute === "*") return "Every minute"
    const step = stepOf(minute, 59)
    if (step === null) return cron
    return step === 1 ? "Every minute" : `Every ${step} min`
  }
  const minuteOf = wholeNumber(minute, 59)
  if (minuteOf === null) return cron
  const hourStep = stepOf(hour, 24)
  if (hourStep !== null) {
    if (minuteOf !== 0) return cron
    return hourStep === 1 ? "Every hour" : `Every ${hourStep} hours`
  }
  const hourOf = wholeNumber(hour, 23)
  if (hourOf === null) return cron
  if (dayOfWeek === "*")
    return `Every day at ${clockWords(momentFor(minuteOf, hourOf, null, opts), opts)}`
  if (dayOfWeek === "1-5")
    return `Weekdays at ${clockWords(momentFor(minuteOf, hourOf, null, opts), opts)}`
  const dow = /^[0-7]$/.test(dayOfWeek) ? Number(dayOfWeek) % 7 : null
  if (dow === null) return cron
  const moment = momentFor(minuteOf, hourOf, dow, opts)
  return `${weekdayWords(moment, opts)} at ${clockWords(moment, opts)}`
}
