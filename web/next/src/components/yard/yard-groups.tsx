"use client"

import { RiArrowRightSLine, RiHashtag, RiUserLine } from "@remixicon/react"
import { cn } from "cn"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { GroupCount } from "@/components/shell/group-count"
import { ROW_BOX } from "@/components/shell/row-box"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { config } from "@/lib/config"
import { isPlainClick } from "@/lib/threads"
import { channelHref, channelTitle, type YardChannel, yardBadge, yardGroups } from "@/lib/yard"
import { useYardChannels } from "@/lib/yard-api"

// The Channels and Direct messages groups, read from the API's Yard router; each is absent while it has no rows, and both while the stack has no Yard. Each collapses as the Scripts group does, its label the toggle, open to start, and counts its rows.
export function YardGroups() {
  const { data } = useYardChannels()
  if (!data) return null
  const { channels, dms } = yardGroups(data)
  return (
    <>
      <YardGroup label="Channels" rows={channels} />
      <YardGroup label="Direct messages" rows={dms} />
    </>
  )
}

function YardGroup({ label, rows }: { label: string; rows: YardChannel[] }) {
  const [open, setOpen] = useState(true)
  if (rows.length === 0) return null
  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="w-full pl-2.5"
        render={<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} />}
      >
        {label}
        <Chevron open={open} />
        <GroupCount count={rows.length} />
      </SidebarGroupLabel>
      {open && <YardRows rows={rows} />}
    </SidebarGroup>
  )
}

const Chevron = ({ open }: { open: boolean }) => (
  <RiArrowRightSLine className={cn("transition-transform", open && "rotate-90")} />
)

// A group's rows, each a Threads row's shape: the stock 32px row, its title cut at its end, its unread count as the badge.
function YardRows({ rows }: { rows: YardChannel[] }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenu className="space-y-0.5">
      {rows.map((row) => {
        const title = channelTitle(row)
        const badge = yardBadge(row)
        const tip = badge ? `${title} · ${badge.label} unread` : title
        return (
          <SidebarMenuItem key={row.id}>
            <SidebarMenuButton
              render={
                <Link
                  href={channelHref(row, config.hosted)}
                  onClick={(event) => {
                    if (isPlainClick(event) && isMobile) setOpenMobile(false)
                  }}
                />
              }
              isActive={pathname === channelHref(row, config.hosted)}
              tooltip={{ children: tip, hidden: false }}
              aria-description={tip}
              className={ROW_BOX}
            >
              {row.kind === "dm" ? <RiUserLine /> : <RiHashtag />}
              <span className="truncate text-xs">{title}</span>
            </SidebarMenuButton>
            {badge && (
              <SidebarMenuBadge
                data-mention={badge.mention || undefined}
                className="data-mention:bg-destructive right-1.5 rounded-full data-mention:text-white"
              >
                {badge.label}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
