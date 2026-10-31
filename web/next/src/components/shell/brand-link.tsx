"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { openPreview } from "@/lib/previews"

// The sidebar's brand: home, and on the dashboard also the Inbox's Preview row, where the owner works on a stack beside the chat.
export function BrandLink({
  children,
  className,
  href,
  opensPreview = false,
}: {
  children: ReactNode
  className: string
  href: string
  opensPreview?: boolean
}) {
  return (
    <Link href={href} className={className} onClick={opensPreview ? openPreview : undefined}>
      {children}
    </Link>
  )
}
