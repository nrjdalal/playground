import { site } from "@packages/config/site"

import { queueRepo, readMergeQueue } from "@/lib/dashboard/merge-queue"
import { queuesMarkdown } from "@/lib/dashboard/queues"
import { readWorkQueue } from "@/lib/dashboard/work-queue"

// Prints both queues as Markdown, the dashboard's own merge queue and then the work queue, from the same reads as GET /api/v1/agents. Read-only.
const [queue, work] = await Promise.all([readMergeQueue(), readWorkQueue()])
process.stdout.write(queuesMarkdown({ name: site.name, queue, repo: queueRepo(), work }))
