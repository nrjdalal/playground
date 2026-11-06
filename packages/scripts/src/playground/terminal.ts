import { join } from "node:path"

// Starts every ops job that is down (up.py), the dashboard's stack and its follower among them, each in herdr's Ops workspace, so they outlive this terminal.
export const startJobs = async (repo: string): Promise<number> => {
  const child = Bun.spawn(["python3", "-I", join(repo, "scripts", "ops", "up.py")], {
    stderr: "inherit",
    stdout: "inherit",
  })
  return child.exited
}
