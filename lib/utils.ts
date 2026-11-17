export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatMedian(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export function filmLabel(film: { title: string; year: number | null }) {
  return film.year ? `${film.title} (${film.year})` : film.title;
}

const STOP = new Set([
  "the",
  "and",
  "from",
  "with",
  "that",
  "this",
  "part",
  "vol",
  "volume",
  "los",
  "las",
  "del",
  "una",
  "uno",
]);

export function repeatedTitleWord(films: { title: string }[]) {
  const counts = new Map<string, number>();
  for (const film of films) {
    const words = new Set(
      film.title
        .toLowerCase()
        .split(/[^a-z0-9áéíóúüñ]+/i)
        .filter((word) => word.length > 3 && !STOP.has(word)),
    );
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  let best: { word: string; count: number } | null = null;
  for (const [word, count] of counts) {
    if (count >= 3 && (!best || count > best.count)) best = { word, count };
  }
  return best;
}

export async function shardKey(name: string) {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(name),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 2);
}
