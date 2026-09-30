// Relationships derive exclusively from the two concept keyword fields.
export const normalizeKeyword = (value) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function deriveRelations(notes) {
  const result = new Map(
    notes.map((n) => [
      n.id,
      {
        prerequisites: new Map(),
        related: new Map(),
        dependents: new Map(),
      },
    ]),
  );
  const add = (map, id, origin, keywords = []) => {
    map.set(id, { id, origin, matched_keywords: keywords });
  };
  const providers = new Map();
  for (const n of notes) {
    for (const key of new Set(n.knowledge_keywords.map(normalizeKeyword))) {
      if (!providers.has(key)) providers.set(key, new Set());
      providers.get(key).add(n.id);
    }
  }
  const candidates = new Map(notes.map((n) => [n.id, new Map()]));
  for (const n of notes) {
    for (const word of n.dependency_keywords) {
      for (const id of providers.get(normalizeKeyword(word)) || []) {
        if (id === n.id || result.get(n.id).prerequisites.has(id)) continue;
        const matches = candidates.get(n.id).get(id) || new Set();
        matches.add(word);
        candidates.get(n.id).set(id, matches);
      }
    }
  }
  // Test against the whole proposed graph: suppress every inferred edge in a
  // cycle, rather than arbitrarily retaining whichever edge was visited first.
  const reachable = (start, target) => {
    const seen = new Set(),
      queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of result.get(id)?.prerequisites.keys() || [])
        queue.push(next);
      for (const next of candidates.get(id)?.keys() || []) queue.push(next);
    }
    return false;
  };
  for (const n of notes) {
    for (const [id, words] of candidates.get(n.id)) {
      if (!reachable(id, n.id))
        add(result.get(n.id).prerequisites, id, "keyword", [...words]);
    }
  }
  for (const n of notes) {
    for (const relation of result.get(n.id).prerequisites.values()) {
      if (result.has(relation.id))
        add(
          result.get(relation.id).dependents,
          n.id,
          relation.origin,
          relation.matched_keywords,
        );
    }
    const related = new Map();
    for (const word of n.knowledge_keywords) {
      for (const id of providers.get(normalizeKeyword(word)) || []) {
        if (id === n.id) continue;
        const words = related.get(id) || new Set();
        words.add(word);
        related.set(id, words);
      }
    }
    for (const [id, words] of related) {
      if (
        result.get(n.id).prerequisites.has(id) ||
        result.get(id).prerequisites.has(n.id)
      )
        continue;
      add(result.get(n.id).related, id, "keyword", [...words]);
    }
  }
  return result;
}
