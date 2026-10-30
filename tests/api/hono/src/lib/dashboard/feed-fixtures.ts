// Pending Feed items as cmux's `rpc feed.list` returned them on probe sessions: a picker, a permission request and a plan.
const workstream = (sessionId: string) =>
  `cmux-feed-v1:${Buffer.from("claude").toString("base64")}:${Buffer.from(sessionId).toString("base64")}`

export const QUESTION_ID = "54FB3383-A4B7-47D1-A6F8-225DF4F9E6A8"
export const PERMISSION_ID = "A70A45B3-D38A-48D9-8D56-CE30BEED2681"
export const PLAN_ID = "836EA043-F9D4-48F7-9917-14B4F76A2B0A"
export const TWO_QUESTION_ID = "B7E4C751-2A1D-4E0B-9C6F-3D5A8F1E2B4C"

export const questionItem = (sessionId: string) => ({
  created_at: "2026-10-05T22:13:16Z",
  id: "431A231E-F152-4A1C-94F5-75E7E5FB124D",
  kind: "question",
  question_multi_select: false,
  question_options: [
    { description: "Red color", id: "opt0", label: "Red" },
    { description: "Blue color", id: "opt1", label: "Blue" },
  ],
  question_prompt: "Pick a color?",
  questions: [
    {
      header: "Color",
      id: "q0",
      multi_select: false,
      options: [
        { description: "Red color", id: "opt0", label: "Red" },
        { description: "Blue color", id: "opt1", label: "Blue" },
      ],
      prompt: "Pick a color?",
    },
  ],
  request_id: QUESTION_ID,
  source: "claude",
  status: "pending",
  title: "AskUserQuestion",
  updated_at: "2026-10-05T22:13:16Z",
  workstream_id: workstream(sessionId),
})

// One AskUserQuestion can ask several questions at once; this one asks a single-choice and a multi-choice together. Built by hand: no feed this suite probed carried a two-question item.
export const twoQuestionItem = (sessionId: string) => ({
  created_at: "2026-10-05T22:14:02Z",
  id: "5C2B9E47-8F3D-4A16-B2E8-7D9C0A4F6E31",
  kind: "question",
  question_multi_select: false,
  question_options: [
    { description: "Red color", id: "opt0", label: "Red" },
    { description: "Blue color", id: "opt1", label: "Blue" },
  ],
  question_prompt: "Pick a color?",
  questions: [
    {
      header: "Color",
      id: "q0",
      multi_select: false,
      options: [
        { description: "Red color", id: "opt0", label: "Red" },
        { description: "Blue color", id: "opt1", label: "Blue" },
      ],
      prompt: "Pick a color?",
    },
    {
      header: "Extras",
      id: "q1",
      multi_select: true,
      options: [
        { description: "Extra foam", id: "opt2", label: "Foam" },
        { description: "Extra shot", id: "opt3", label: "Shot" },
        { description: "No sugar", id: "opt4", label: "No sugar" },
      ],
      prompt: "Add anything else?",
    },
  ],
  request_id: TWO_QUESTION_ID,
  source: "claude",
  status: "pending",
  title: "AskUserQuestion",
  updated_at: "2026-10-05T22:14:02Z",
  workstream_id: workstream(sessionId),
})

export const permissionItem = (sessionId: string) => ({
  created_at: "2026-10-06T02:24:17Z",
  cwd: "/repo",
  id: "1AD04E1F-B2DF-4E0B-975F-22ABDA1E5224",
  kind: "permissionRequest",
  request_id: PERMISSION_ID,
  source: "claude",
  status: "pending",
  title: "Bash",
  tool_input: JSON.stringify({
    command: "touch /tmp/scratch/denied-marker",
    description: "Create an empty marker file in the probe folder",
  }),
  tool_name: "Bash",
  updated_at: "2026-10-06T02:24:17Z",
  workstream_id: workstream(sessionId),
})

export const planItem = (sessionId: string) => ({
  created_at: "2026-10-06T02:26:12Z",
  cwd: "/repo",
  default_mode: "manual",
  id: "41ED1C9F-1608-48D3-853E-2C5054DFBB52",
  kind: "exitPlan",
  plan: JSON.stringify({
    plan: "# Plan: create the plan-marker file\n\n## Step\n1. touch plan-marker\n",
    planFilePath: "/Users/me/.claude/plans/plan.md",
  }),
  request_id: PLAN_ID,
  source: "claude",
  status: "pending",
  title: "ExitPlanMode",
  updated_at: "2026-10-06T02:26:12Z",
  workstream_id: workstream(sessionId),
})
