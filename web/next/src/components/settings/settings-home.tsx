"use client"

import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { Accounts } from "@/components/settings/accounts"
import { Extensions } from "@/components/settings/extensions"
import { MacChecks } from "@/components/settings/mac-checks"
import { PageHeader } from "@/components/shell/page-header"

// The Settings page the user menu opens, on the owner rung, its sections one under the other.
export function SettingsHome() {
  const { allowed } = useDashboard()
  return (
    <>
      <PageHeader
        title="Settings"
        description="This Mac's accounts, extensions and how the Dashboard runs."
      />
      {allowed ? (
        <div className="flex flex-col gap-6">
          <MacChecks />
          <Accounts />
          <Extensions />
        </div>
      ) : (
        <OwnerOnly title="Settings are for the owner" why="They read this Mac's accounts" />
      )}
    </>
  )
}
