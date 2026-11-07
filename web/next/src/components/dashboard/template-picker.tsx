"use client"

import { RiAddLine } from "@remixicon/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import Link from "next/link"
import { useState } from "react"

import { Hint } from "@/components/hint"
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { readTemplates, startTemplate, TEMPLATES_QUERY_KEY, templateRowView } from "@/lib/templates"

const ADD_LABEL = "Add a dispatcher or orchestrator"

// Alpha's plus, in its effort's place (the row's toggle rule but for hover, which counts over its own box alone, PLUS_SHOWN as className): a picker of sessions.templates, one row each, its label then its backend or model and effort, muted; a row a gate would refuse shows disabled with its reason. Picking a row starts it, a spinner on the row until the API answers, and a refusal's words show whole in a toast.
export function TemplatePicker({
  className,
  secondRunning,
}: {
  className?: string
  secondRunning: boolean
}) {
  const [open, setOpen] = useState(false)
  const templates = useQuery({
    enabled: open,
    queryFn: readTemplates,
    queryKey: TEMPLATES_QUERY_KEY,
  })
  const start = useMutation({
    mutationFn: startTemplate,
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSuccess: (name) => {
      setOpen(false)
      toast.add({ title: `Started ${name}`, type: "success" })
    },
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint content={ADD_LABEL} description={null}>
        <PopoverTrigger
          render={
            <SidebarMenuAction
              aria-label={ADD_LABEL}
              className={cn(className, "data-[popup-open]:opacity-100")}
            />
          }
        >
          <RiAddLine />
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" side="bottom" className="w-64 gap-1 p-1">
        <Command loop>
          <CommandList aria-busy={templates.isPending || undefined}>
            <CommandEmpty className="text-muted-foreground py-3 text-xs">
              {templates.error
                ? templates.error.message
                : templates.isPending
                  ? "Reading templates…"
                  : "No templates"}
            </CommandEmpty>
            {templates.data?.map((row) => {
              const view = templateRowView(row, secondRunning)
              const starting = start.isPending && start.variables === row.id
              return (
                <CommandItem
                  key={row.id}
                  value={row.id}
                  disabled={Boolean(view.reason) || start.isPending}
                  onSelect={() => start.mutate(row.id)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{view.label}</span>
                    {starting && <Spinner className="size-3.5" />}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {view.reason ?? view.detail}
                  </span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
        <Link
          href="/dashboard/settings#templates"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground border-t px-2 pt-1.5 pb-1 text-xs"
        >
          Edit templates
        </Link>
      </PopoverContent>
    </Popover>
  )
}
