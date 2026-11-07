"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { SetUpSettings } from "@/components/settings/set-up-settings"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ACCOUNTS_QUERY_KEY, readAccounts } from "@/lib/accounts"
import { JOBS_QUERY_KEY, type JobRow, readJobs, saveJobToggle } from "@/lib/jobs"
import { whenWords } from "@/lib/ops"

// Settings > Jobs: each ops job Playground ships, what it does, when it runs and whether it is on, and a switch that turns it on or off at your login's scope, its enabled field alone. Before the settings are set up it shows Set up settings, as Privacy does.
export function Jobs() {
  const login = useQuery({ queryKey: ACCOUNTS_QUERY_KEY, queryFn: readAccounts })
  const scope = login.data?.scope
  const jobs = useQuery({
    enabled: Boolean(scope),
    queryFn: () => readJobs(scope!),
    queryKey: JOBS_QUERY_KEY,
  })
  const error = login.error ?? jobs.error
  return (
    <section aria-labelledby="settings-jobs" className="flex flex-col gap-2">
      <h2 id="settings-jobs" className="text-muted-foreground text-sm font-medium">
        Jobs
      </h2>
      {login.data?.login === false ? (
        <SetUpSettings />
      ) : error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Jobs could not be read</EmptyTitle>
            <EmptyDescription>{error.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : scope && jobs.data ? (
        <JobList jobs={jobs.data} scope={scope} />
      ) : (
        <div aria-busy="true" className="h-14" />
      )}
    </section>
  )
}

function JobList({ jobs, scope }: { jobs: JobRow[]; scope: string }) {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: ({ job, on }: { job: JobRow; on: boolean }) => saveJobToggle(job, on, scope),
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY }),
    onSuccess: (_, { job, on }) =>
      toast.add({ title: `${job.name} turned ${on ? "on" : "off"}`, type: "success" }),
  })
  return (
    <>
      <p className="text-muted-foreground text-xs">
        A switch saves whether the job runs, nothing else, and the runner starts or stops it on its
        next pass.
      </p>
      <ItemGroup className="gap-2">
        {jobs.map((job) => (
          <Item key={job.key} role="listitem" size="sm" variant="outline" className="items-start">
            <ItemContent className="min-w-0 gap-1.5 py-1 text-xs">
              <ItemTitle className="font-mono">{job.name}</ItemTitle>
              <ItemDescription className="text-xs">{job.description}</ItemDescription>
              <p className="text-muted-foreground text-2xs">
                {[
                  job.schedule ? (whenWords(job.schedule) ?? "") : "",
                  job.set ? "set in your settings" : "default",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </ItemContent>
            <ItemActions>
              <Switch
                aria-label={`${job.name} on`}
                checked={job.enabled}
                disabled={toggle.isPending}
                onCheckedChange={(on) => toggle.mutate({ job, on })}
                size="sm"
              />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </>
  )
}
