// A titled part of the Plan page, as Usage's are: a muted h2 over its content, named by that heading.
export function Section({
  children,
  id,
  title,
}: {
  children: React.ReactNode
  id: string
  title: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-muted-foreground text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}
