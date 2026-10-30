import { redirect } from "next/navigation"

// The dashboard is the home: a visit with no session gets its first-run pane there.
export default function Home() {
  redirect("/dashboard")
}
