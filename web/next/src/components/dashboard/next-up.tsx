import { Hint } from "@/components/hint"

// The roster's backlog still waiting, in the order they go out (fixes, then the owner's own asks, then the rest), one line each with the whole item on hover.
export function NextUp({ backlog }: { backlog: string[] }) {
  return (
    <section aria-labelledby="next-up" className="flex flex-col gap-2">
      <h2 id="next-up" className="text-muted-foreground text-sm font-medium">
        Next up
      </h2>
      {backlog.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing queued.</p>
      ) : (
        <ol className="flex list-inside list-decimal flex-col gap-1 text-sm">
          {backlog.map((item, i) => (
            <Hint key={`${i}:${item}`} content={item}>
              <li className="truncate">{item}</li>
            </Hint>
          ))}
        </ol>
      )}
    </section>
  )
}
