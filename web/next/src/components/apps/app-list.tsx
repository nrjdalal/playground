"use client"

import { RiArrowRightSLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { type DashboardAppId, dashboardApps } from "@/lib/apps"
import { fetchPlan, PLAN_QUERY_KEY } from "@/lib/plan"
import { fetchPreviews, PREVIEWS_QUERY_KEY } from "@/lib/previews"
import { relativeTime } from "@/lib/time"

// When the planner last groomed the plan, from the same query the Plan page reads.
function PlanFreshness() {
  const { data, dataUpdatedAt } = useQuery({ queryKey: PLAN_QUERY_KEY, queryFn: fetchPlan })
  if (data === undefined) return null
  return data.plan
    ? `Groomed ${relativeTime(data.plan.generatedAt, new Date(dataUpdatedAt))}`
    : "No plan yet"
}

// When the newest preview arrived, from the same query the Previews page reads.
function PreviewsFreshness() {
  const { data, dataUpdatedAt } = useQuery({ queryKey: PREVIEWS_QUERY_KEY, queryFn: fetchPreviews })
  if (data === undefined) return null
  const newest = data.previews[0]
  return newest
    ? `Newest ${relativeTime(newest.modifiedAt, new Date(dataUpdatedAt))}`
    : "No previews yet"
}

// An app that reports when it last ran says so on its row; one that does not shows no time.
const FRESHNESS: Partial<Record<DashboardAppId, () => React.ReactNode>> = {
  plan: PlanFreshness,
  previews: PreviewsFreshness,
}

// The Apps home: one row per app the aside lists, each opening its page.
export function AppList() {
  const { allowed } = useDashboard()
  if (!allowed) return <OwnerOnly />
  return (
    <ItemGroup className="gap-2">
      {dashboardApps().map((app) => {
        const Freshness = FRESHNESS[app.id]
        return (
          <Item key={app.id} variant="outline" render={<Link href={app.href} />}>
            <ItemMedia variant="icon">
              <app.icon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{app.title}</ItemTitle>
              <ItemDescription>{app.description}</ItemDescription>
            </ItemContent>
            <ItemActions className="text-muted-foreground text-xs">
              {Freshness && <Freshness />}
              <RiArrowRightSLine className="size-4" />
            </ItemActions>
          </Item>
        )
      })}
    </ItemGroup>
  )
}
