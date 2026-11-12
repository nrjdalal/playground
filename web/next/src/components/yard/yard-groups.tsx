"use client"

import { RiArrowRightSLine, RiHashtag, RiUserLine } from "@remixicon/react"
import { cn } from "cn"
import Link from "next/link"
import { usePathname } from "next/navigation"

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
import { useGroupOpen } from "@/lib/sidebar-groups"
import { isPlainClick } from "@/lib/threads"
import {
  channelHref,
  channelTitle,
  type YardChannel,
  type YardShell,
  yardBadge,
  yardGroups,
} from "@/lib/yard"
import { useYardChannels } from "@/lib/yard-api"

// The Channels and Direct messages groups, read from the API's Yard router; each is absent while it has no rows, and both while the stack has no Yard. Each collapses as every sidebar group does, its label the toggle, open to start and kept as you left it across reloads, and counts its rows.
export function YardGroups({ shell }: { shell: YardShell }) {
  const { data } = useYardChannels()
  const [channelsOpen, setChannelsOpen] = useGroupOpen("Channels", true)
  const [dmsOpen, setDmsOpen] = useGroupOpen("Direct messages", true)
  if (!data) return null
  const { channels, dms } = yardGroups(data)
  return (
    <>
      {channels.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel
            className="w-full pl-2.5"
            render={toggle(channelsOpen, setChannelsOpen)}
          >
            Channels
            <Chevron open={channelsOpen} />
            <GroupCount count={channels.length} />
          </SidebarGroupLabel>
          {channelsOpen && <YardRows rows={channels} shell={shell} />}
        </SidebarGroup>
      )}
      {dms.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="w-full pl-2.5" render={toggle(dmsOpen, setDmsOpen)}>
            Direct messages
            <Chevron open={dmsOpen} />
            <GroupCount count={dms.length} />
          </SidebarGroupLabel>
          {dmsOpen && <YardRows rows={dms} shell={shell} />}
        </SidebarGroup>
      )}
    </>
  )
}

const toggle = (open: boolean, setOpen: (open: boolean) => void) => (
  <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} />
)

const Chevron = ({ open }: { open: boolean }) => (
  <RiArrowRightSLine className={cn("transition-transform", open && "rotate-90")} />
)

// A group's rows, each a Threads row's shape: the stock 32px row, its icon, then a channel's bare name (the # icon is its one hash) or the other member's login, cut at its end, its unread count as the badge.
export function YardRows({ rows, shell }: { rows: YardChannel[]; shell: YardShell }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenu className="space-y-0.5">
      {rows.map((row) => {
        const title = channelTitle(row)
        const href = channelHref(row, shell)
        const badge = yardBadge(row)
        // the tooltip says a mention in words, so the badge's colour is never its only mark
        const tip = badge
          ? `${title} · ${badge.label} unread${badge.mention ? ", mentions you" : ""}`
          : title
        return (
          <SidebarMenuItem key={row.id}>
            <SidebarMenuButton
              render={
                <Link
                  href={href}
                  onClick={(event) => {
                    if (isPlainClick(event) && isMobile) setOpenMobile(false)
                  }}
                />
              }
              isActive={pathname === href}
              tooltip={{ children: tip, hidden: false }}
              aria-description={tip}
              className={ROW_BOX}
            >
              {row.kind === "dm" ? <RiUserLine /> : <RiHashtag />}
              <span className="truncate text-xs">{row.kind === "dm" ? title : row.name}</span>
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
