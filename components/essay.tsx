"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { EgoGraph, FilmSheet } from "@/components/ego-graph";
import { Input } from "@/components/ui/input";
import type { Ego, FilmCredit, Neighbor, SearchHit, Story } from "@/lib/types";
import {
  filmLabel,
  formatCount,
  formatMedian,
  repeatedTitleWord,
  shardKey,
} from "@/lib/utils";

type Lang = "en" | "es";

type FilmIndexRow = [string, number | null, string, string];

type FilmHit = {
  title: string;
  year: number | null;
  tconst: string;
  directors: string[];
  cast: string[];
  more: number;
  pending: boolean;
};

const shardCache = new Map<string, Record<string, Ego>>();
const creditCache = new Map<string, Record<string, [string[], string[], number]>>();
let filmsPromise: Promise<FilmCredit[]> | null = null;

type CompactNeighbor = [
  string,
  number,
  "c" | "d",
  string | null,
  number,
  number[],
  number,
];

function loadFilms() {
  filmsPromise ??= fetch("/red/films.json")
    .then((response) => {
      if (!response.ok) throw new Error("films");
      return response.json() as Promise<[string, number | null, string][]>;
    })
    .then((rows) => rows.map(([title, year, tconst]) => ({ title, year, tconst })));
  return filmsPromise;
}

function expandEgo(
  id: string,
  raw: [number, number, number, number, CompactNeighbor[]],
  films: FilmCredit[],
): Ego {
  const [filmCount, asActor, asDirector, omitted, neighbors] = raw;
  return {
    id,
    name: id,
    filmCount,
    asActor,
    asDirector,
    omitted,
    neighbors: neighbors.map(([name, weight, kind, director, count, indexes, more]) => ({
      id: name,
      name,
      weight,
      kind: kind === "c" ? "costar" : "directed",
      director,
      filmCount: count,
      // Every index is a shared film. The spine draws one row per film.
      films: indexes.map((index) => films[index]),
      more,
    })),
  };
}

function titles(films: { title: string; year: number | null }[], more: number, limit = 6) {
  const shown = films.slice(0, limit).map(filmLabel);
  const hidden = more + Math.max(0, films.length - limit);
  if (!shown.length) return "";
  if (!hidden) return shown.join(", ");
  return `${shown.join(", ")} + ${hidden}`;
}

function partnerName(opening: NonNullable<Story["opening"]>) {
  return opening.center === opening.a ? opening.b : opening.a;
}

function queryParts(raw: string) {
  const tokens = raw.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let year: number | null = null;
  const words: string[] = [];
  for (const token of tokens) {
    if (year == null && /^(18|19|20)\d{2}$/.test(token)) year = Number(token);
    else words.push(token);
  }
  return { year, text: words.join(" ") };
}

function filmNetwork(
  title: string,
  year: number | null,
  tconst: string,
  directors: string[],
  cast: string[],
  more: number,
  counts: Map<string, number>,
): Ego | null {
  const center = directors[0] || cast[0];
  if (!center) return null;
  const directorSet = new Set(directors);
  const castSet = new Set(cast);
  const seen = new Set<string>([center]);
  const others: string[] = [];
  for (const name of [...directors, ...cast]) {
    if (seen.has(name)) continue;
    seen.add(name);
    others.push(name);
  }
  const film = { title, year, tconst };
  const centerDirects = directorSet.has(center);
  const neighbors: Neighbor[] = others.slice(0, 24).map((name) => {
    const directs = directorSet.has(name);
    return {
      id: name,
      name,
      weight: 1,
      kind: centerDirects || directs ? "directed" : "costar",
      director: directs ? name : centerDirects ? center : null,
      filmCount: counts.get(name) ?? 1,
      films: [film],
      more: 0,
    };
  });
  return {
    id: `${tconst}:${center}`,
    name: center,
    filmCount: 1,
    asActor: castSet.has(center) ? 1 : 0,
    asDirector: centerDirects ? 1 : 0,
    omitted: more,
    neighbors,
  };
}

export function Essay({ story }: { story: Story }) {
  const params = useSearchParams();
  const lang: Lang = params.get("lang") === "es" ? "es" : "en";
  const opening = story.opening;
  const initial = story.openingEgo;
  const [ego, setEgo] = useState<Ego | null>(initial);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [filmIndex, setFilmIndex] = useState<FilmIndexRow[] | null>(null);
  const [sheet, setSheet] = useState<FilmHit | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [focusFilm, setFocusFilm] = useState<{
    title: string;
    year: number | null;
    people: number;
    tconst: string;
    directors: string[];
    cast: string[];
    more: number;
  } | null>(null);
  const [searchError, setSearchError] = useState(false);
  const graphRef = useRef<HTMLElement>(null);
  const filmRequest = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const filmCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const hit of hits ?? []) counts.set(hit.id, hit.filmCount);
    return counts;
  }, [hits]);

  const personResults = useMemo(() => {
    const { text } = queryParts(query);
    if (!hits || text.length < 2) return [];
    return hits
      .filter((hit) => hit.name.toLocaleLowerCase().includes(text))
      .sort((a, b) => {
        const aStart = a.name.toLocaleLowerCase().startsWith(text) ? 0 : 1;
        const bStart = b.name.toLocaleLowerCase().startsWith(text) ? 0 : 1;
        return aStart - bStart || b.filmCount - a.filmCount || a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }, [hits, query]);

  const filmResults = useMemo(() => {
    const { year, text } = queryParts(query);
    if (!filmIndex || (text.length < 2 && year == null)) return [];
    const ranked: { film: FilmIndexRow; rank: number }[] = [];
    for (const row of filmIndex) {
      if (year != null && row[1] !== year) continue;
      const folded = row[0].toLocaleLowerCase();
      let rank = 1;
      if (text) {
        if (!folded.includes(text)) continue;
        rank = folded === text ? 0 : folded.startsWith(text) ? 1 : 2;
      }
      ranked.push({ rank, film: row });
    }
    ranked.sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.film[1] ?? 9999) - (b.film[1] ?? 9999) ||
        a.film[0].localeCompare(b.film[0]),
    );
    return ranked.slice(0, 8).map((item) => item.film);
  }, [filmIndex, query]);

  useEffect(() => {
    let cancel = false;
    fetch("/red/film-index.json")
      .then((response) => {
        if (!response.ok) throw new Error("films");
        return response.json() as Promise<FilmIndexRow[]>;
      })
      .then((rows) => {
        if (!cancel) setFilmIndex(rows);
      })
      .catch(() => {
        if (!cancel) setSearchError(true);
      });
    fetch("/red/search.json")
      .then((response) => {
        if (!response.ok) throw new Error("search");
        return response.json() as Promise<SearchHit[]>;
      })
      .then((rows) => {
        if (!cancel) setHits(rows);
      })
      .catch(() => {
        if (!cancel) setSearchError(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const openFilmId = sheet?.tconst ?? null;

  useEffect(() => {
    if (!openFilmId) return;
    graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openFilmId]);

  function revealGraph() {
    graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openFilm(row: FilmIndexRow) {
    const [title, year, tconst] = row;
    filmRequest.current = tconst;
    setQuery("");
    setSheet(null);
    setHighlight(tconst);
    setStatus("loading");
    const key = tconst.length >= 2 ? tconst.slice(-2) : "xx";
    const draw = (directors: string[], cast: string[], more: number) => {
      if (filmRequest.current !== tconst) return;
      const network = filmNetwork(title, year, tconst, directors, cast, more, filmCounts);
      if (!network) {
        setStatus("error");
        return;
      }
      const people = new Set([...directors, ...cast]).size;
      setFocusFilm({ title, year, people, tconst, directors, cast, more });
      setEgo(network);
      setStatus("idle");
      revealGraph();
    };
    const cached = creditCache.get(key)?.[tconst];
    if (cached) {
      draw(cached[0], cached[1], cached[2]);
      return;
    }
    void fetch(`/red/credits/${key}.json`)
      .then((response) => {
        if (!response.ok) throw new Error("credits");
        return response.json() as Promise<Record<string, [string[], string[], number]>>;
      })
      .then((bucket) => {
        creditCache.set(key, bucket);
        const rowCredits = bucket[tconst];
        if (!rowCredits) throw new Error("missing");
        draw(rowCredits[0], rowCredits[1], rowCredits[2]);
      })
      .catch(() => {
        if (filmRequest.current === tconst) setStatus("error");
      });
  }

  async function openPerson(id: string, filmTconst: string | null = null) {
    filmRequest.current = null;
    setFocusFilm(null);
    setHighlight(filmTconst);
    setSheet(null);
    if (ego?.id === id) {
      revealGraph();
      return;
    }
    if (initial?.id === id) {
      setEgo(initial);
      setStatus("idle");
      setQuery("");
      if (!filmTconst) revealGraph();
      return;
    }
    setStatus("loading");
    try {
      const key = await shardKey(id);
      let bucket = shardCache.get(key);
      if (!bucket) {
        const [films, response] = await Promise.all([
          loadFilms(),
          fetch(`/red/shards/${key}.json`),
        ]);
        if (!response.ok) throw new Error("shard");
        const compact = (await response.json()) as Record<
          string,
          [number, number, number, number, CompactNeighbor[]]
        >;
        bucket = Object.fromEntries(
          Object.entries(compact).map(([personId, raw]) => [
            personId,
            expandEgo(personId, raw, films),
          ]),
        );
        shardCache.set(key, bucket);
      }
      const next = bucket[id];
      if (!next) throw new Error("missing");
      setEgo(next);
      setStatus("idle");
      setQuery("");
      if (!filmTconst) revealGraph();
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!focusFilm) return;
    const network = filmNetwork(
      focusFilm.title,
      focusFilm.year,
      focusFilm.tconst,
      focusFilm.directors,
      focusFilm.cast,
      focusFilm.more,
      filmCounts,
    );
    if (network) setEgo(network);
  }, [focusFilm, filmCounts]);

  useEffect(() => {
    const { year, text } = queryParts(query);
    if (year == null || text.length < 2 || filmResults.length !== 1) return;
    const [title, filmYear] = filmResults[0];
    if (title.toLocaleLowerCase() !== text || filmYear !== year) return;
    openFilm(filmResults[0]);
  }, [query, filmResults]);

  const es = lang === "es";
  const median = formatMedian(story.corpus.medianCast);
  const seriesWord = opening ? repeatedTitleWord(opening.films) : null;
  const partner = opening ? partnerName(opening) : "";
  const href = (code: Lang) => (code === "es" ? "/?lang=es" : "/");
  const home = href(es ? "es" : "en");

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 md:px-8">
        <a href={home} className="font-display text-xl tracking-[0.14em] text-[var(--blood)]">
          PULP
          <span className="ml-2 text-[var(--ink)]">ANALYTICS</span>
        </a>
        <nav className="font-mono text-[11px] tracking-[0.16em]">
          <a href="/" className={es ? "text-[var(--ink-dim)]" : "text-[var(--ink)]"}>
            EN
          </a>
          <span className="mx-2 text-[var(--line)]">/</span>
          <a
            href="/?lang=es"
            className={es ? "text-[var(--ink)]" : "text-[var(--ink-dim)]"}
          >
            ES
          </a>
        </nav>
      </header>

      <form
        className="sticky top-0 z-30 border-y border-[var(--line)] bg-[var(--bg)]"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="relative mx-auto w-full max-w-xl px-5 py-3">
          <label
            htmlFor="person-search"
            className="font-mono text-[11px] tracking-[0.14em] text-[var(--amber)] uppercase"
          >
            {es ? "Buscar una película o una persona" : "Find a film or a person"}
          </label>
          <Input
            id="person-search"
            value={query}
            placeholder={es ? "Halloween 1931, Scream 1996, un nombre" : "Halloween 1931, Scream 1996, a name"}
            className="mt-2 font-serif"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.trim().length >= 2 ? (
            <div className="mt-2 max-h-[70vh] overflow-auto border border-[var(--line)] bg-[var(--bg)]">
              {!filmIndex && !searchError ? (
                <p className="px-3 py-3 text-sm text-[var(--ink-dim)]">
                  {es ? "Buscando…" : "Searching…"}
                </p>
              ) : null}
              {searchError && !filmIndex ? (
                <p className="px-3 py-3 text-sm text-[var(--blood)]">
                  {es ? "No pude abrir el índice de películas." : "I could not open the film index."}
                </p>
              ) : null}
              {filmResults.length > 0 || personResults.length > 0 ? (
                <ul>
                  {filmResults.map((film) => (
                    <li key={film[2]}>
                      <button
                        type="button"
                        className="flex w-full items-baseline justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--bg2)]"
                        onClick={() => openFilm(film)}
                      >
                        <span className="text-lg">{film[0]}</span>
                        <span className="shrink-0 font-mono text-[11px] text-[var(--ink-dim)]">
                          {film[1] ?? "—"}
                          {film[3] ? ` · ${film[3]}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                  {personResults.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="flex w-full items-baseline justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--bg2)]"
                        onClick={() => void openPerson(hit.id)}
                      >
                        <span className="text-lg">{hit.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-[var(--ink-dim)]">
                          {hit.filmCount} · {es ? "persona" : "person"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {filmIndex && hits && filmResults.length === 0 && personResults.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[var(--ink-dim)]">
                  {es ? "No hay una película ni una persona con ese nombre." : "No film or person matches that name."}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </form>

      <article className="mx-auto w-full max-w-3xl px-5 pb-8 md:px-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--amber)] uppercase">
          {es ? "Créditos de terror" : "Horror credits"}
        </p>
        <h1 className="mt-4 font-display text-6xl leading-[0.9] text-[var(--ink)] md:text-8xl">
          {es ? (
            <>
              Quién <span className="text-[var(--blood)]">vuelve</span>
              <br /> a trabajar
            </>
          ) : (
            <>
              Who keeps
              <br /> coming <span className="text-[var(--blood)]">back</span>
            </>
          )}
        </h1>
        <p className="mt-6 max-w-xl text-xl leading-8 text-[var(--ink)]">
          {es
            ? "El género parece una multitud. Los primeros nombres del cartel se vuelven a contratar."
            : "The genre looks like a crowd. The first names on the sheet keep hiring each other."}
        </p>
        <p className="mt-6 font-mono text-[11px] tracking-[0.08em] text-[var(--ink-dim)]">
          Juan Pablo Duque · {es ? "noviembre" : "November"} 2026 · 8 min
        </p>

        {opening && initial && ego ? (
          <div className="mt-12 space-y-6 text-lg leading-8">
            <p>
              {es
                ? `La línea más repetida une a ${opening.center} y ${partner}. Pesa ${opening.weight} películas: ${titles(opening.films, opening.more)}.`
                : `The most repeated line joins ${opening.center} and ${partner}. It weighs ${opening.weight} films: ${titles(opening.films, opening.more)}.`}
            </p>
            <p>
              {es
                ? `${opening.center} ocupa el centro porque, de los dos, es quien acumula más películas de terror en este corte: ${initial.filmCount}. La espina es su filmografía, de arriba abajo según el año. El círculo actúa y el rombo dirige. Si alguien hace las dos cosas, el rombo queda dentro del círculo. La curva de sangre es un crédito de reparto. La curva ámbar es un crédito de dirección.`
                : `${opening.center} sits in the center because, of the two, they have the longer horror list in this cut: ${initial.filmCount} films. The spine is that filmography, top to bottom by year. A circle acts and a diamond directs. When someone does both, the diamond sits inside the circle. A blood curve is a cast credit. An amber curve is a directing credit.`}
            </p>
            <p className="text-base leading-7 text-[var(--ink-dim)]">
              {es
                ? "Escribe Halloween 1931 o Scream 1996. La red de esa película se abre sola: el director en el centro y el reparto a los lados. Un nombre con más películas abre su red completa."
                : "Type Halloween 1931 or Scream 1996. That film’s network opens on its own: the director in the center and the cast on the sides. A name with more films opens their full network."}
            </p>
          </div>
        ) : (
          <p className="mt-12 text-lg">
            {es
              ? "Este corte no encontró créditos para dibujar."
              : "This cut did not find credits to draw."}
          </p>
        )}
      </article>

      {ego ? (
        <section ref={graphRef} className="mx-auto w-full max-w-[1440px] scroll-mt-32 border-y border-[var(--line)]">
          {sheet ? (
            <FilmSheet
              title={sheet.title}
              year={sheet.year}
              directors={sheet.directors}
              cast={sheet.cast}
              more={sheet.more}
              pending={sheet.pending}
              lang={lang}
              filmCount={(name) => filmCounts.get(name) ?? 0}
              onOpen={(id) => void openPerson(id, sheet.tconst)}
            />
          ) : (
            <EgoGraph
              ego={ego}
              lang={lang}
              highlightTconst={highlight}
              centerOpens={focusFilm != null && (filmCounts.get(ego.name) ?? 0) >= 2}
              onCenter={(id) => void openPerson(id, highlight)}
            />
          )}
          <p className="border-t border-[var(--line)] px-5 py-3 text-center font-mono text-[11px] tracking-[0.08em] text-[var(--ink-dim)]">
            {status === "loading"
              ? es
                ? "Abriendo esa red."
                : "Opening that circle."
              : status === "error"
                ? es
                  ? "No pude abrir esa red. Prueba con otro nombre."
                  : "I could not open that circle. Try another name."
                : focusFilm
                  ? es
                    ? `${focusFilm.title}${focusFilm.year ? ` · ${focusFilm.year}` : ""} · ${focusFilm.people} personas en la red`
                    : `${focusFilm.title}${focusFilm.year ? ` · ${focusFilm.year}` : ""} · ${focusFilm.people} people on the network`
                  : sheet
                    ? `${sheet.title}${sheet.year ? ` · ${sheet.year}` : ""}`
                    : es
                    ? `${ego.name} · ${ego.filmCount} películas · ${ego.asActor} en reparto · ${ego.asDirector} en dirección · ${ego.omitted} compañeros fuera del dibujo`
                    : `${ego.name} · ${ego.filmCount} films · ${ego.asActor} billed · ${ego.asDirector} directing · ${ego.omitted} collaborators left off the drawing`}
          </p>
        </section>
      ) : null}

      <article className="mx-auto w-full max-w-3xl space-y-16 px-5 py-16 md:px-8">
        <ListBlock
          kicker={es ? "Quién acumula más películas" : "Who has the most films"}
          onOpen={(id) => void openPerson(id)}
          items={story.mostFilms.map((person) => ({
            key: person.id,
            people: [{ id: person.id, name: person.name }],
            detail: es
              ? `${person.filmCount} películas · ${person.asActor} en reparto · ${person.asDirector} en dirección`
              : `${person.filmCount} films · ${person.asActor} billed · ${person.asDirector} directing`,
          }))}
        />
        <ListBlock
          kicker={es ? "Quién dirige a los mismos" : "Who keeps directing the same people"}
          onOpen={(id) => void openPerson(id)}
          items={story.topDirected.map((edge) => ({
            key: `${edge.a}-${edge.b}`,
            people: [
              { id: edge.a, name: edge.a },
              { id: edge.b, name: edge.b },
            ],
            detail: `${edge.weight} · ${titles(edge.films, edge.more, 3)}`,
          }))}
        />
        <ListBlock
          kicker={es ? "Quién comparte el cartel" : "Who shares the sheet"}
          onOpen={(id) => void openPerson(id)}
          items={story.topCostar.map((edge) => ({
            key: `${edge.a}-${edge.b}`,
            people: [
              { id: edge.a, name: edge.a },
              { id: edge.b, name: edge.b },
            ],
            detail: `${edge.weight} · ${titles(edge.films, edge.more, 3)}`,
          }))}
        />

        <section className="border-l-2 border-[var(--amber)] pl-5">
          <h2 className="font-mono text-[11px] tracking-[0.16em] text-[var(--amber)] uppercase">
            {es ? "Mi lectura" : "My reading"}
          </h2>
          <div className="mt-4 space-y-4 text-lg leading-8">
            <p>
              {es
                ? "Los datos muestran quién vuelve, no por qué."
                : "The data show who comes back, not why."}
            </p>
            {opening ? (
              <p>
                {seriesWord
                  ? es
                    ? `En el vínculo más repetido, la palabra «${seriesWord.word}» aparece en ${seriesWord.count} títulos. Es una serie que conserva a su gente.`
                    : `On the most repeated link, the word “${seriesWord.word}” shows up on ${seriesWord.count} titles. A series is keeping its people.`
                  : es
                    ? "Los títulos del vínculo más repetido no comparten un nombre. Lo que se repite es la pareja, no una franquicia."
                    : "The titles on the most repeated link do not share a name. What repeats is the partnership, not a franchise title."}
              </p>
            ) : null}
            {story.mostFilms[0] && opening ? (
              <p>
                {story.mostFilms[0].name === opening.center ||
                story.mostFilms[0].name === partner
                  ? es
                    ? `${story.mostFilms[0].name} también es quien más películas acumula en este corte: ${story.mostFilms[0].filmCount}.`
                    : `${story.mostFilms[0].name} is also the busiest name in this cut: ${story.mostFilms[0].filmCount} films.`
                  : es
                    ? `${story.mostFilms[0].name} aparece en ${story.mostFilms[0].filmCount} películas, más que nadie. El vínculo más repetido está en otra parte: una pareja puede repetirse sin que ninguno de los dos sea el nombre más ocupado.`
                    : `${story.mostFilms[0].name} appears on ${story.mostFilms[0].filmCount} films, more than anyone. The most repeated link is somewhere else: a pair can repeat without either name being the busiest.`}
              </p>
            ) : null}
            <p>
              {es
                ? `La película mediana de este corte trae ${median} nombres facturados. Eso es la puerta, no el equipo entero. Un extra que cruza el fondo no está. Tampoco hay un id de persona: la misma grafía es la misma persona.`
                : `The median film in this cut carries ${median} billed names. That is the doorway, not the whole crew. An extra crossing the back of the shot is absent. There is no person id either: the same spelling is the same person.`}
            </p>
          </div>
        </section>

        <section>
          <h2 className="font-display text-4xl leading-none">
            {es ? "Fuentes y método" : "Sources and methods"}
          </h2>
          <div className="mt-6 space-y-4 text-base leading-7 text-[var(--ink-dim)]">
            <p className="font-mono text-[12px] tracking-[0.04em] text-[var(--ink)]">
              {story.corpus.source} · n = {formatCount(story.corpus.films)}{" "}
              {es ? "películas" : "films"} · {formatCount(story.corpus.people)}{" "}
              {es ? "personas" : "people"} · {story.corpus.minYear}–{story.corpus.maxYear} ·{" "}
              {es ? "mediana de nombres" : "median billed names"} {median}
            </p>
            <p>
              {es
                ? "Cada fila es una película ya estrenada, con Horror como uno de sus géneros exactos. Salen las que TMDB marca como adultas. Esa marca deja pasar mucho terror erótico, así que también sale una película si alguna palabra clave es, exactamente, cine erótico o pornográfico: erotic movie, softcore, sexploitation, pink film, pornography, hentai, nunsploitation, erotic horror y las variantes cercanas. Una película de terror que solo tiene una escena sexual se queda. Torture porn se queda: es el nombre que la crítica le da al terror violento, no una película para adultos. No saqué a ningún director por su nombre. El reparto es la columna cast: nombres separados por coma, en el orden en que el archivo los guardó. En las películas que revisé a mano, Halloween 1978, 2007 y 2018, esa columna trae diez nombres. La dirección es la columna directors de la misma fila. No llamé al API de TMDB."
                : "Each row is a released film with Horror as one of its exact genres. Films TMDB flags as adult are out. That flag misses a lot of erotic horror, so a film is also out when one keyword is an exact token for erotic or pornographic cinema: erotic movie, softcore, sexploitation, pink film, pornography, hentai, nunsploitation, erotic horror, and the close variants of those. A horror film that merely contains a sex scene stays. Torture porn stays: that phrase is a critic's name for violent horror, not an adult film. No director was removed by name. The cast is the cast column: comma-separated names, in the order the file stored them. On the films I checked by hand — Halloween 1978, 2007, and 2018 — that column holds ten names. Directors are the directors column on the same row. I did not call the TMDB API."}
            </p>
            <p>
              {es
                ? "No mezclé las listas de Letterboxd. Si unas películas aportaran diez nombres y otras cuarenta, quien saliera en la lista larga parecería más conectado. Una fuente, un corte."
                : "I did not merge Letterboxd lists. If some films contributed ten names and others forty, whoever appeared on the longer list would look more connected. One source, one cut."}
            </p>
            <p>
              {es
                ? "Una curva de sangre une a dos nombres del reparto cuando ninguno dirige esa película. Una curva ámbar une a quien dirige con quien está en el cartel, y también a dos directores de la misma película. El círculo es quien actúa en ese vínculo y el rombo es quien dirige. La espina ordena las películas por año, de arriba abajo. El dibujo guarda, por persona con al menos dos películas, los 24 vínculos más pesados, con todas las películas de cada vínculo. Una película que no toca a ninguno de esos 24 no entra en la espina. El resto de la gente entra en la cuenta de omitidos."
                : "A blood curve joins two billed names when neither directed that film. An amber curve joins a director and someone on the sheet, and also two directors of the same film. A circle acts on that link and a diamond directs. The spine orders the films by year, top to bottom. For each person with at least two films, the drawing keeps the 24 heaviest links, with every film on each link. A film that touches none of those 24 stays off the spine. Everyone else is counted as omitted."}
            </p>
            <p>
              {es
                ? "El archivo no trae un id de persona ni separa las películas de televisión si TMDB las etiquetó como terror estrenado. Dos grafías distintas de un mismo nombre no se unen."
                : "The file has no person id, and it does not separate television films when TMDB tagged them as released horror. Two spellings of the same name stay apart."}
            </p>
          </div>
        </section>
      </article>

      <footer className="border-t border-[var(--line)] px-5 py-10 md:px-8">
        <p className="font-display text-2xl tracking-[0.12em] text-[var(--blood)]">PULP ANALYTICS</p>
        <p className="mt-3 font-mono text-[11px] tracking-[0.12em] text-[var(--ink-dim)]">
          Data stories with teeth ·{" "}
          <a className="underline" href="https://medium.com/pulp-analytics">
            medium.com/pulp-analytics
          </a>
        </p>
      </footer>
    </div>
  );
}

function ListBlock({
  kicker,
  items,
  onOpen,
}: {
  kicker: string;
  items: { key: string; people: { id: string; name: string }[]; detail: string }[];
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="font-display text-4xl leading-none md:text-5xl">{kicker}</h2>
      <ol className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {items.map((item, index) => (
          <li key={item.key} className="grid gap-1 py-4 md:grid-cols-[2.5rem_1fr]">
            <span className="font-mono text-[11px] tracking-[0.14em] text-[var(--amber)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="text-xl leading-7">
                {item.people.map((person, personIndex) => (
                  <span key={person.id}>
                    {personIndex > 0 ? " — " : null}
                    <button
                      type="button"
                      className="underline decoration-[var(--line)] underline-offset-4 hover:decoration-[var(--amber)]"
                      onClick={() => onOpen(person.id)}
                    >
                      {person.name}
                    </button>
                  </span>
                ))}
              </p>
              <p className="mt-1 font-mono text-[12px] leading-5 text-[var(--ink-dim)]">{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
