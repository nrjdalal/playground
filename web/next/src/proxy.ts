import { type NextRequest, NextResponse } from "next/server"

import { config as app } from "@/lib/config"

// The hosted build (Yard) serves none of the dashboard's local pages: each answers the app's 404 before it renders, and a local stack passes straight through. Yard's own views, as they land, are the exception this proxy lets through.
export const proxyFor = (hosted: boolean) => (request: NextRequest) =>
  hosted ? NextResponse.rewrite(new URL("/404", request.url)) : NextResponse.next()

export const proxy = proxyFor(app.hosted)

export const config = { matcher: ["/dashboard", "/dashboard/:path*"] }
