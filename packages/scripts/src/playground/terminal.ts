import { join } from "node:path"

// The terminal playground status names; the factory's sessions run in herdr, which playground starts and playground view opens.
export const TERMINAL = "cmux terminal"

// Whether this process descends from a cmux terminal, which alone cmux's socket answers; playground status reports it, and nothing refuses on it.
export const insideTerminal = (): boolean => Boolean(process.env.CMUX_SOCKET_PATH)

// up.py's exit when it left the Dashboard's job down only because it runs outside cmux, as its docstring says.
export const OUTSIDE_CMUX = 3

// Starts every ops job that is down (up.py), the dashboard's stack and its follower among them, each in its runtime's Ops workspace (an auto job's in cmux while cmux holds a session, else in herdr), so they outlive this terminal.
export const startJobs = async (repo: string): Promise<number> => {
  const child = Bun.spawn(["python3", "-I", join(repo, "scripts", "ops", "up.py")], {
    stderr: "inherit",
    stdout: "inherit",
  })
  return child.exited
}
