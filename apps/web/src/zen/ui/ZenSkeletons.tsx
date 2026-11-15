// Zen Staff loading placeholders shaped like the content (Alex's rule: skeletons for pages and
// sections, spinners only inside buttons for an action in progress).
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";

/** A few text lines (a paragraph, a document, a status). */
export function SkeletonLines(props: { readonly lines?: number; readonly className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", props.className)} aria-hidden data-zen-skeleton>
      {Array.from({ length: props.lines ?? 3 }, (_, index) =>
        index % 3 === 2 ? (
          <Skeleton key={index} className="h-3.5 w-2/3" />
        ) : index % 3 === 1 ? (
          <Skeleton key={index} className="h-3.5 w-11/12" />
        ) : (
          <Skeleton key={index} className="h-3.5 w-full" />
        ),
      )}
    </div>
  );
}

/** Rows of a list: an icon, a title and a detail line each. */
export function SkeletonRows(props: { readonly rows?: number; readonly className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", props.className)} aria-hidden data-zen-skeleton>
      {Array.from({ length: props.rows ?? 3 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Cards in a grid (roles, apps). */
export function SkeletonCards(props: { readonly count?: number; readonly className?: string }) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", props.className)} aria-hidden data-zen-skeleton>
      {Array.from({ length: props.count ?? 4 }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full" />
      ))}
    </div>
  );
}
