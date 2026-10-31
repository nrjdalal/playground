"use client"

import { RiCheckLine, RiErrorWarningLine, RiTimeLine } from "@remixicon/react"
import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { cn } from "cn"
import { useState } from "react"

import { Hint, OFF_FOCUSABLE } from "@/components/hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Item } from "@/components/ui/item"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { agentLabel } from "@/lib/agent-label"
import { HOLDS_RELOAD } from "@/lib/build-reload"
import {
  isAnswered,
  needsYouAnchor,
  nextStep,
  type NeedsYou,
  type NeedsYouGiven,
  type NeedsYouBody,
  type NeedsYouQuestion,
  type NeedsYouResolution,
  type OnAnswer,
  submitWhy,
} from "@/lib/needs-you"
import { relativeTime } from "@/lib/time"

// An answered card, collapsed to one line: what the owner chose and what became of it.
function Resolved({ item, resolution }: { item: NeedsYou; resolution: NeedsYouResolution }) {
  const chose = resolution.choices.length
    ? `You chose ${resolution.choices.join(", ")}${resolution.text ? ", with a note" : ""}`
    : `You said “${resolution.text ?? ""}”`
  const whole = [item.title, chose, resolution.summary, resolution.text].filter(Boolean).join(" · ")
  // Each part truncates on its own, so a narrow screen still shows a little of all three; the whole line, note included, is the row's Hint.
  return (
    <Hint content={whole}>
      <Item
        id={needsYouAnchor(item.id)}
        data-slot="needs-you-resolved"
        variant="outline"
        size="xs"
        className="text-muted-foreground min-w-0 scroll-mt-4 flex-nowrap text-xs"
      >
        {resolution.state === "done" ? (
          <RiCheckLine className="text-success size-4 shrink-0" />
        ) : resolution.state === "failed" ? (
          <RiErrorWarningLine className="text-destructive size-4 shrink-0" />
        ) : (
          <RiTimeLine className="text-inactive size-4 shrink-0" />
        )}
        <span className="text-foreground min-w-0 truncate">{item.title}</span>
        <span className="shrink-0">·</span>
        <span className="min-w-0 truncate">{chose}</span>
        <span className="shrink-0">·</span>
        <span
          className={cn(
            "min-w-0 truncate",
            resolution.state === "done" && "text-success",
            resolution.state === "failed" && "text-destructive",
          )}
        >
          {resolution.summary}
        </span>
      </Item>
    </Hint>
  )
}

// What a permission would run, or the plan it would start, shown whole above the choices, so what is approved is what was read.
function Body({ body, label }: { body: NeedsYouBody; label: string }) {
  return (
    <pre
      data-slot="needs-you-body"
      role="region"
      tabIndex={0}
      aria-label={label}
      className={cn(
        "bg-muted max-h-[40svh] overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap",
        body.kind === "code" ? "font-mono" : "font-sans",
      )}
    >
      {body.text}
    </pre>
  )
}

// What waits on the owner, inside the stream of the session that asked: a Feed prompt (a picker, a permission, a plan), one card shape for all, on shadcn's Questionnaire. One question shows at a time, with Previous and Next between them; pick an option (the recommended one comes first and says so), add words where a question takes them, and Submit sends every answer at once. Without onAnswer the card is shown as it would be answered but can only be answered in the session's terminal: its options stay in sight, disabled one by one, since Questionnaire hides a disabled question whole. With a resolution it collapses to one line.
export function NeedsYouCard({
  item,
  now,
  onAnswer,
  resolution,
}: {
  item: NeedsYou
  now: Date
  onAnswer: OnAnswer | null
  resolution: NeedsYouResolution | null
}) {
  const send = useMutation({
    mutationFn: async (given: NeedsYouGiven[]) => {
      if (!onAnswer) throw new Error("This can only be answered in the session's terminal")
      const answers = Object.fromEntries(
        item.questions.map((question, i) => [
          question.id,
          { choices: given[i]?.choices ?? [], text: given[i]?.text.trim() || null },
        ]),
      )
      const result = await onAnswer(item, { answers })
      if (!result.ok) throw Object.assign(new Error(result.reason), { sent: result.sent === true })
      return result
    },
    // A refusal that says to look at the terminal stays on the card, and sending again becomes its own step.
    onMutate: () => setFailure(null),
    onError: (error) => {
      setFailure({ reason: error.message, sent: (error as { sent?: boolean }).sent === true })
      toast.add({ title: error.message, type: "error" })
    },
    onSuccess: ({ state, summary }) =>
      toast.add({
        description: summary,
        title: `Answered ${agentLabel(item.from)}`,
        type: state === "failed" ? "warning" : "success",
      }),
  })
  const [failure, setFailure] = useState<{ reason: string; sent: boolean } | null>(null)
  // The question in sight, held here rather than in Questionnaire, so a read-only card can step through its questions without answering them.
  const [current, setCurrent] = useState(item.questions[0]?.id ?? "")
  const form = useForm({
    defaultValues: { given: item.questions.map((): NeedsYouGiven => ({ choices: [], text: "" })) },
    onSubmit: ({ value }) => send.mutateAsync(value.given).catch(() => undefined),
  })

  if (resolution) return <Resolved item={item} resolution={resolution} />

  const readOnly = onAnswer === null
  const locked = readOnly || send.isPending || send.isSuccess
  const formId = needsYouAnchor(`${item.id}-form`)
  const titleId = needsYouAnchor(`${item.id}-title`)
  const whyId = needsYouAnchor(`${item.id}-why`)
  const index = Math.max(
    0,
    item.questions.findIndex((question) => question.id === current),
  )
  // A lone question that only restates the title is named by it rather than shown twice.
  const restated = (question: NeedsYouQuestion) =>
    item.questions.length === 1 && question.prompt === item.title
  // Next, Submit and their keys go by the card's own answers (nextStep); a read-only card steps on without one.
  const goNext = () => setCurrent(item.questions[index + 1]?.id ?? current)
  const step = () => {
    const move = nextStep(form.state.values.given, index)
    if (move === "next") goNext()
    else if (move === "submit" && !locked) void form.handleSubmit()
  }
  // A read-only card with one question has nothing to step to or send.
  const actions = !readOnly || item.questions.length > 1

  return (
    <Card
      size="sm"
      id={needsYouAnchor(item.id)}
      data-slot="needs-you-card"
      {...{ [HOLDS_RELOAD]: "" }}
      className="scroll-mt-4"
    >
      <CardHeader>
        <CardTitle id={titleId}>{item.title}</CardTitle>
        {item.context && <CardDescription className="text-xs">{item.context}</CardDescription>}
        <CardAction className="text-muted-foreground flex items-center gap-2 text-xs">
          <Hint content={item.from}>
            <Badge variant="outline">{agentLabel(item.from)}</Badge>
          </Hint>
          {item.at && <span>{relativeTime(item.at, now)}</span>}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {item.body && <Body body={item.body} label={item.title} />}
        <Questionnaire
          id={formId}
          item={current}
          onItemChange={setCurrent}
          // Questionnaire's own keys (Cmd/Ctrl+Enter, Enter on a choice) would run its checks, which miss a note given alone, so the card's step runs instead.
          onKeyDown={(event) => {
            const target = event.target
            const onChoice =
              target instanceof HTMLInputElement &&
              (target.type === "checkbox" || target.type === "radio")
            if (event.key !== "Enter" || event.shiftKey || event.altKey) return
            if (event.nativeEvent.isComposing || (!onChoice && !event.metaKey && !event.ctrlKey))
              return
            event.preventDefault()
            if (!readOnly) step()
          }}
          onSubmit={(event) => {
            event.preventDefault()
            if (!locked) void form.handleSubmit()
          }}
          className="gap-3"
        >
          {item.questions.length > 1 && <QuestionnaireProgress />}
          {item.questions.map((question, q) => {
            const hintId = needsYouAnchor(`${item.id}-${question.id}-hint`)
            const textId = needsYouAnchor(`${item.id}-${question.id}-text`)
            return (
              <QuestionnaireItem
                key={question.id}
                name={question.id}
                multiple={question.multiSelect}
                aria-labelledby={restated(question) ? `${titleId} ${hintId}` : undefined}
                className="gap-3"
              >
                <QuestionnaireTitle
                  id={hintId}
                  className={restated(question) ? "sr-only" : "text-xs"}
                >
                  {restated(question)
                    ? question.multiSelect
                      ? "Pick any that apply"
                      : "Pick one"
                    : question.prompt}
                </QuestionnaireTitle>
                {question.options.length > 0 && (
                  <form.Field name={`given[${q}].choices`}>
                    {(field) => (
                      <QuestionnaireChoices>
                        {question.options.map((option) => (
                          <QuestionnaireChoice
                            key={option.id}
                            value={option.label}
                            checked={field.state.value.includes(option.label)}
                            disabled={locked}
                            className="text-xs"
                            onChange={(event) => {
                              const checked = event.target.checked
                              field.handleChange(
                                question.multiSelect
                                  ? checked
                                    ? [...field.state.value, option.label]
                                    : field.state.value.filter((c) => c !== option.label)
                                  : [option.label],
                              )
                              if (question.textInstead) form.setFieldValue(`given[${q}].text`, "")
                            }}
                          >
                            <span className="flex items-center gap-2">
                              {option.label}
                              {option.recommended && <Badge variant="secondary">Recommended</Badge>}
                            </span>
                            {option.description && (
                              <QuestionnaireChoiceDescription>
                                {option.description}
                              </QuestionnaireChoiceDescription>
                            )}
                          </QuestionnaireChoice>
                        ))}
                      </QuestionnaireChoices>
                    )}
                  </form.Field>
                )}
                {question.allowText && (
                  <form.Field name={`given[${q}].text`}>
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={textId} className="text-xs">
                          {question.textLabel ??
                            (question.options.length > 0 ? "Anything to add" : "Your answer")}
                        </FieldLabel>
                        <Textarea
                          id={textId}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value)
                            if (question.textInstead && event.target.value.trim()) {
                              form.setFieldValue(`given[${q}].choices`, [])
                            }
                          }}
                          maxLength={2000}
                          aria-describedby={titleId}
                          disabled={locked}
                          className="md:text-xs"
                        />
                      </Field>
                    )}
                  </form.Field>
                )}
              </QuestionnaireItem>
            )
          })}
          {/* Next and Submit go by the card's own answers rather than Questionnaire's checks, which count only its own controls: a note alone is an answer the API takes, and a read-only card steps on without one. */}
          {actions && (
            <form.Subscribe selector={(state) => state.values.given}>
              {(given) => {
                const why = readOnly ? null : submitWhy(item.questions, given)
                return (
                  // in a row, the step forward first: Submit, off until every question is answered and saying why on hover and focus, then Next, then Previous
                  <QuestionnaireActions className="flex flex-wrap">
                    {readOnly ? null : (
                      <>
                        {/* describedby would hide the Hint's aria-description, so the reason a screen reader hears is named beside the title instead */}
                        <Hint content={why ?? undefined} description={null}>
                          <QuestionnaireSubmit
                            type="button"
                            aria-describedby={why ? `${titleId} ${whyId}` : titleId}
                            disabled={!given.every(isAnswered) || locked}
                            render={<Button {...OFF_FOCUSABLE} />}
                            onClick={step}
                          >
                            {send.isPending ? <Spinner /> : null}
                            {failure?.sent ? "Send again" : "Submit"}
                          </QuestionnaireSubmit>
                        </Hint>
                        {why ? (
                          <span id={whyId} className="sr-only">
                            {why}
                          </span>
                        ) : null}
                      </>
                    )}
                    <QuestionnaireNext
                      disabled={!readOnly && !isAnswered(given[index])}
                      onClick={(event) => {
                        event.preventDefault()
                        if (readOnly) goNext()
                        else step()
                      }}
                    />
                    <QuestionnairePrevious />
                  </QuestionnaireActions>
                )
              }}
            </form.Subscribe>
          )}
        </Questionnaire>
        {failure && (
          <p role="alert" className="text-destructive text-xs">
            {failure.reason}
          </p>
        )}
      </CardContent>
      {readOnly && (
        <CardFooter className="text-muted-foreground text-xs">
          {item.herdr
            ? `Answer it in ${agentLabel(item.from)}'s terminal, in herdr: the Dashboard answers only a herdr session's pickers.`
            : item.hosted
              ? `Approving a ${item.kind} here is off for now, so it is refused after 10 minutes.`
              : item.kind === "permission" || item.kind === "plan"
                ? `Answer it in ${agentLabel(item.from)}'s terminal: approving a ${item.kind} here is off for now.`
                : `This can only be answered in ${agentLabel(item.from)}'s terminal.`}
        </CardFooter>
      )}
    </Card>
  )
}
