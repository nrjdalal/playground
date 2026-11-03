// A group label's count, at its right as ZeroSDK's countCell: how many sessions the group holds (heldCount), the jobs Scripts lists, or a Yard group's rows, muted with tabular digits.
export function GroupCount({ count }: { count: number }) {
  return (
    <span data-slot="group-count" className="ml-auto flex w-4 justify-center tabular-nums">
      {count}
    </span>
  )
}
