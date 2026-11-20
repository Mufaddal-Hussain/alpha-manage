// Boundary below the shared layout: each page streams in behind this while its session/data reads resolve.
export default function Loading() {
  return <p className="p-2 text-sm text-muted">Loading…</p>;
}
