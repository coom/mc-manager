// jsdom n'implémente pas window.matchMedia : cette aide installe une version
// minimale qui évalue les requêtes `(min-width: Npx)` / `(max-width: Npx)`
// contre une largeur simulée et prévient les écouteurs quand elle change.
type Listener = (ev: { matches: boolean }) => void;

let width = 1280;
const lists = new Set<{ query: string; listeners: Set<Listener>; last: boolean }>();

function evaluate(query: string): boolean {
  return query.split(',').some((part) =>
    part.split(' and ').every((clause) => {
      const m = /\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/.exec(clause);
      if (!m) return true;
      const n = Number(m[2]);
      return m[1] === 'min' ? width >= n : width <= n;
    }),
  );
}

export function installMatchMedia() {
  window.matchMedia = (query: string): MediaQueryList => {
    const entry = { query, listeners: new Set<Listener>(), last: evaluate(query) };
    lists.add(entry);
    const mql = {
      media: query,
      get matches() { return evaluate(query); },
      onchange: null,
      addEventListener: (_: 'change', l: Listener) => { entry.listeners.add(l); },
      removeEventListener: (_: 'change', l: Listener) => { entry.listeners.delete(l); },
      addListener: (l: Listener) => { entry.listeners.add(l); },
      removeListener: (l: Listener) => { entry.listeners.delete(l); },
      dispatchEvent: () => false,
    };
    return mql as unknown as MediaQueryList;
  };
}

/** Change la largeur simulée et notifie les écouteurs dont le résultat change. */
export function setViewportWidth(px: number) {
  width = px;
  for (const entry of lists) {
    const matches = evaluate(entry.query);
    if (matches === entry.last) continue;
    entry.last = matches;
    for (const l of entry.listeners) l({ matches });
  }
}
