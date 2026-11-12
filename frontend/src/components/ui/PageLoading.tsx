import { useEffect, useState } from "react";

/** Page-shaped skeleton, shown only if the route takes longer than 200 ms so quick loads never flash. */
export function PageLoading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), 200);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div role="status" aria-label="Loading page" className="mx-auto mt-6 flex max-w-[1120px] flex-col gap-4">
      <span className="sr-only">Loading…</span>
      {late && (
        <div aria-hidden className="page-loading flex flex-col gap-4">
          <div className="skeleton h-9 w-1/3" />
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-40 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
          </div>
        </div>
      )}
    </div>
  );
}
