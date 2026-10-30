// A made-up fix for fixture stacks, so no stack off this machine's own reads installs anything: it prints a few lines over about 2s and exits 0, and for gh-login prints a one-time code as gh does, waits for Enter, holds the code up for about 3s, then signs in as no one.
import { FIX_IDS } from "../lib/onboard/fix-ids"

const id = process.argv[2] ?? ""
if (!(FIX_IDS as readonly string[]).includes(id)) {
  console.error(`this made-up fix takes one of ${FIX_IDS.join(", ")}`)
  process.exit(2)
}

const say = async (line: string) => {
  process.stdout.write(`${line}\n`)
  await Bun.sleep(400)
}

if (id === "gh-login") {
  await say("! First copy your one-time code: MADE-0001")
  process.stdout.write(`Press Enter to open https://github.com/login/device in your browser... `)
  for await (const _ of console) break
  await say("")
  await say("Waiting for the code to be entered at GitHub")
  await Bun.sleep(3_000)
  await say("✓ Authentication complete.")
  await say("✓ Logged in as made-up-owner")
} else {
  await say(`Made-up ${id} fix: nothing is installed on a fixture stack`)
  await say("Working")
  await say("Done")
}
