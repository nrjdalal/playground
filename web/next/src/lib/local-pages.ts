import { notFound } from "next/navigation"

// The hosted build (Yard) serves none of the dashboard's local pages: their layout calls this first, so each answers the app's 404 before it reads anything, and a local stack passes straight through.
export const localPagesOnly = (hosted: boolean) => {
  if (hosted) notFound()
}
