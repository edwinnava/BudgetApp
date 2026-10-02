type Listener = () => void;
const listeners = new Set<Listener>();

/** Called after every write so mounted screens re-query. */
export function notifyChange(): void {
  listeners.forEach((l) => l());
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
