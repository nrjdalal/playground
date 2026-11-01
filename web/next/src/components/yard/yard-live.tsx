"use client"

import { useYardSocket } from "@/lib/yard-api"

// The signed-in tab's one socket, so a new message reaches its channel and the sidebar's counts without a reload.
export function YardLive() {
  useYardSocket()
  return null
}
