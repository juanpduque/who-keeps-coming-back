"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { Ego, FilmCredit, LinkKind, Neighbor } from "@/lib/types";
import { filmLabel } from "@/lib/utils";

type Lang = "en" | "es";

type Side = "left" | "right";

type SpineFilm = {
  key: string;
  film: FilmCredit;
  people: Neighbor[];
  y: number;
};

type SidePerson = {
  neighbor: Neighbor;
  side: Side;
  y: number;
};

const TOP = 64;

function filmKey(film: FilmCredit) {
  return film.tconst || `${film.title}|${film.year ?? ""}`;
}

function shorten(text: string, px: number, size = 12) {
  const max = Math.max(4, Math.floor(px / (size * 0.64)));
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function kindColor(kind: LinkKind) {
  return kind === "costar" ? "var(--blood)" : "var(--amber)";
}

type PersonRole = "actor" | "director" | "both";

function personRole(neighbor: Neighbor, center: string): PersonRole {
  if (neighbor.kind === "costar" || neighbor.director === center) return "actor";
  if (neighbor.director === neighbor.name) return "director";
  return "both";
}

function diamondPath(x: number, y: number, r: number) {
  return `M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`;
}

function roleWord(role: PersonRole, lang: Lang) {
  if (role === "director") return lang === "es" ? "dirige" : "directs";
  if (role === "both") return lang === "es" ? "dirige y actúa" : "directs and acts";
  return lang === "es" ? "actúa" : "acts";
}

function centerRole(ego: Ego, lang: Lang) {
  const directs = ego.asDirector > 0;
  const acts = ego.asActor > 0;
  if (directs && acts) return lang === "es" ? "Dirección y reparto" : "Directs and acts";
  if (directs) return lang === "es" ? "Dirección" : "Directs";
  if (acts) return lang === "es" ? "Reparto" : "Acts";
  return "";
}

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mid = (x1 + x2) / 2;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${mid.toFixed(1)} ${y1.toFixed(1)}, ${mid.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function layoutSpine(neighbors: Neighbor[], width: number) {
  const narrow = width < 680;
  const row = narrow ? 36 : 44;
  const titleSize = narrow ? 13 : 15;
  const nameSize = narrow ? 12 : 14;
  const byKey = new Map<string, { film: FilmCredit; people: Neighbor[] }>();
  for (const neighbor of neighbors) {
    for (const film of neighbor.films) {
      const key = filmKey(film);
      const entry = byKey.get(key) ?? { film, people: [] };
      if (!entry.people.some((person) => person.id === neighbor.id)) entry.people.push(neighbor);
      byKey.set(key, entry);
    }
  }
  const ordered = [...byKey.entries()]
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => {
      if (a.film.year == null && b.film.year == null) return a.film.title.localeCompare(b.film.title);
      if (a.film.year == null) return 1;
      if (b.film.year == null) return -1;
      return a.film.year - b.film.year || a.film.title.localeCompare(b.film.title);
    });
  const films: SpineFilm[] = ordered.map((film, index) => ({
    ...film,
    y: TOP + index * row,
  }));
  const longestTitle = Math.max(72, ...films.map((film) => film.film.title.length * titleSize * 0.64), 0);
  const longestName = Math.max(64, ...neighbors.map((person) => person.name.length * nameSize * 0.64), 0);
  let nameLane = Math.min(narrow ? 118 : 200, Math.max(narrow ? 88 : 136, longestName + 32));
  let columnW = Math.min(narrow ? 250 : 420, 58 + longestTitle + 18);
  const minCurve = narrow ? 22 : 72;
  const minColumn = narrow ? 128 : 220;
  const shortfall = nameLane * 2 + columnW + minCurve * 2 - width;
  if (shortfall > 0) {
    const titleGive = Math.min(shortfall, Math.max(0, columnW - minColumn));
    columnW -= titleGive;
    nameLane -= Math.min(Math.max(0, shortfall - titleGive), Math.max(0, nameLane - (narrow ? 72 : 100)));
  }
  const curveLane = Math.max(16, (width - nameLane * 2 - columnW) / 2);
  const columnL = nameLane + curveLane;
  const columnR = columnL + columnW;
  const mid = (films.length - 1) / 2;
  const people: SidePerson[] = neighbors.map((neighbor, neighborIndex) => {
    const hits = films.filter((film) => film.people.some((person) => person.id === neighbor.id));
    const median = hits.length ? hits[Math.floor(hits.length / 2)] : films[0];
    const index = median ? films.indexOf(median) : 0;
    return {
      neighbor,
      side: films.length === 1 ? (neighborIndex % 2 === 0 ? "left" : "right") : index <= mid ? "left" : "right",
      y: median?.y ?? TOP,
    };
  });
  const gap = Math.max(32, nameSize + 18);
  for (const side of ["left", "right"] as const) {
    const group = people
      .filter((person) => person.side === side)
      .sort((a, b) => a.y - b.y || a.neighbor.name.localeCompare(b.neighbor.name));
    let last = -Infinity;
    for (const person of group) {
      if (person.y < last + gap) person.y = last + gap;
      last = person.y;
    }
  }
  const bottom = Math.max(TOP, ...films.map((film) => film.y), ...people.map((person) => person.y));
  return { films, people, columnL, columnR, columnW, nameLane, row, titleSize, nameSize, height: bottom + 48 };
}

export function EgoGraph({
  ego,
  lang,
  onCenter,
  highlightTconst = null,
  centerOpens = false,
}: {
  ego: Ego;
  lang: Lang;
  onCenter: (id: string) => void;
  highlightTconst?: string | null;
  centerOpens?: boolean;
}) {
  const labelId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [hover, setHover] = useState<{ egoId: string; type: "person" | "film"; id: string } | null>(
    null,
  );
  const pointer = hover && hover.egoId === ego.id ? hover : null;

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (!next) return;
      setWidth((current) => (Math.abs(current - next) < 2 ? current : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const laid = useMemo(() => layoutSpine(ego.neighbors, width), [ego.neighbors, width]);

  useEffect(() => {
    if (!highlightTconst) return;
    const film = laid.films.find((item) => item.film.tconst === highlightTconst);
    if (!film) return;
    setHover({ egoId: ego.id, type: "film", id: film.key });
    const svg = frame.current?.querySelector("svg");
    if (!svg) return;
    const scale = svg.getBoundingClientRect().height / laid.height;
    const top = svg.getBoundingClientRect().top + window.scrollY + film.y * scale - window.innerHeight * 0.35;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [highlightTconst, ego.id, laid.films, laid.height]);

  const litPerson = pointer?.type === "person" ? pointer.id : null;
  const litFilm = pointer?.type === "film" ? pointer.id : null;
  const serif = "var(--font-source), Georgia, serif";
  const mono = "var(--font-space), ui-monospace, monospace";

  function personX(person: SidePerson) {
    return person.side === "left" ? laid.nameLane : width - laid.nameLane;
  }

  function edgeLit(person: SidePerson, film: SpineFilm) {
    if (litFilm) return film.key === litFilm && film.people.some((item) => item.id === person.neighbor.id);
    if (litPerson) return person.neighbor.id === litPerson;
    return false;
  }

  function enterPerson(neighbor: Neighbor) {
    setHover({ egoId: ego.id, type: "person", id: neighbor.id });
  }

  function enterFilm(film: SpineFilm) {
    setHover({ egoId: ego.id, type: "film", id: film.key });
  }

  const edges = laid.people.flatMap((person) =>
    laid.films
      .filter((film) => film.people.some((item) => item.id === person.neighbor.id))
      .map((film) => ({ person, film, lit: edgeLit(person, film) })),
  );

  return (
    <div ref={frame} className="relative w-full bg-[var(--bg)]">
      <svg
        role="group"
        aria-labelledby={labelId}
        width={width}
        height={laid.height}
        viewBox={`0 0 ${width} ${laid.height}`}
      >
        <title id={labelId}>
          {lang === "es" ? `Películas de ${ego.name}` : `${ego.name}, films and collaborators`}
        </title>
        {centerOpens ? (
          <rect
            x={laid.columnL}
            y={8}
            width={Math.max(96, ego.name.length * 14)}
            height={26}
            fill="transparent"
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={lang === "es" ? `Abrir la red de ${ego.name}` : `Open ${ego.name}`}
            onClick={() => onCenter(ego.name)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onCenter(ego.name);
              }
            }}
          />
        ) : null}
        <text
          x={laid.columnL}
          y={30}
          fill="var(--ink)"
          fontFamily="var(--font-anton), 'Arial Narrow', Impact, sans-serif"
          fontSize={22}
          textDecoration={centerOpens ? "underline" : undefined}
          className="pointer-events-none"
        >
          {ego.name}
        </text>
        <text x={laid.columnL} y={48} fill={ego.asDirector > 0 ? "var(--amber)" : "var(--ink-dim)"} fontFamily={mono} fontSize={11}>
          {centerRole(ego, lang).toUpperCase()}
        </text>
        <line
          x1={laid.columnL}
          y1={TOP - 14}
          x2={laid.columnL}
          y2={laid.films.at(-1)?.y ?? TOP}
          stroke="var(--line)"
        />
        {edges
          .slice()
          .sort((a, b) => Number(a.lit) - Number(b.lit))
          .map(({ person, film, lit }) => (
            <path
              key={`${person.neighbor.id}-${film.key}`}
              d={curve(
                personX(person),
                person.y,
                person.side === "left" ? laid.columnL : laid.columnR,
                film.y,
              )}
              fill="none"
              stroke={kindColor(person.neighbor.kind)}
              strokeWidth={lit ? 1.8 : 1.2}
              strokeOpacity={litPerson || litFilm ? (lit ? 0.95 : 0.08) : 0.42}
              className="pointer-events-none"
            />
          ))}
        {laid.films.map((film) => {
          const hot = litFilm === film.key || (litPerson != null && film.people.some((person) => person.id === litPerson));
          const year = film.film.year == null ? "—" : String(film.film.year);
          const titleRoom = laid.columnW - 70;
          const label = `${filmLabel(film.film)}. ${film.people.map((person) => person.name).join(", ")}`;
          return (
            <g key={film.key}>
              <rect
                x={laid.columnL - 8}
                y={film.y - laid.row / 2 + 2}
                width={laid.columnW + 16}
                height={laid.row - 4}
                fill="transparent"
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={label}
                onMouseEnter={() => enterFilm(film)}
                onFocus={() => enterFilm(film)}
                onClick={() => enterFilm(film)}
              >
                <title>{label}</title>
              </rect>
              <circle
                cx={laid.columnL}
                cy={film.y}
                r={hot ? 5.5 : 4}
                fill={hot ? "var(--ink)" : "var(--ink-dim)"}
                className="pointer-events-none"
              />
              <text
                x={laid.columnL + 14}
                y={film.y}
                dominantBaseline="middle"
                fill="var(--ink-dim)"
                fontFamily={mono}
                fontSize={11}
                className="pointer-events-none"
              >
                {year}
              </text>
              <text
                x={laid.columnL + 58}
                y={film.y}
                dominantBaseline="middle"
                fill="var(--ink)"
                fontFamily={serif}
                fontSize={laid.titleSize}
                className="pointer-events-none"
              >
                {shorten(film.film.title, titleRoom, laid.titleSize)}
              </text>
            </g>
          );
        })}
        {laid.people.map((person) => {
          const x = personX(person);
          const onLitFilm =
            litFilm != null &&
            laid.films.some(
              (film) => film.key === litFilm && film.people.some((item) => item.id === person.neighbor.id),
            );
          const chosen = litPerson === person.neighbor.id || onLitFilm;
          const quiet = (litPerson != null || litFilm != null) && !chosen;
          const room = Math.max(36, laid.nameLane - 22);
          const canOpen = person.neighbor.filmCount >= 2;
          const role = personRole(person.neighbor, ego.name);
          const full = chosen ? `${person.neighbor.name} · ${person.neighbor.weight}` : person.neighbor.name;
          const name = shorten(full, room, laid.nameSize);
          const radius = chosen ? 8 : 6.5;
          const markVisual = {
            fill: "var(--bg)",
            stroke: role === "actor" ? "var(--ink)" : "var(--amber)",
            strokeWidth: chosen ? 2 : 1.5,
            strokeOpacity: quiet ? 0.35 : 1,
            className: "pointer-events-none",
          };
          const textX = person.side === "left" ? x - 16 : x + 16;
          const hitX = person.side === "left" ? textX - room : x - radius - 8;
          const openPerson = () => {
            if (canOpen) onCenter(person.neighbor.id);
            else enterPerson(person.neighbor);
          };
          return (
            <g key={person.neighbor.id}>
              <text
                x={textX}
                y={person.y}
                textAnchor={person.side === "left" ? "end" : "start"}
                dominantBaseline="middle"
                fill={quiet ? "var(--line)" : "var(--ink)"}
                fontFamily={serif}
                fontSize={laid.nameSize}
                textDecoration={canOpen ? "underline" : undefined}
                className="pointer-events-none"
              >
                {name}
              </text>
              {role === "director" ? (
                <path d={diamondPath(x, person.y, radius)} {...markVisual} />
              ) : (
                <circle cx={x} cy={person.y} r={radius} {...markVisual} />
              )}
              <rect
                x={hitX}
                y={person.y - 16}
                width={room + radius + 28}
                height={32}
                fill="transparent"
                className={canOpen ? "cursor-pointer" : undefined}
                role="button"
                tabIndex={0}
                aria-label={
                  canOpen
                    ? lang === "es"
                      ? `Abrir la red de ${person.neighbor.name}, ${roleWord(role, lang)}`
                      : `Open ${person.neighbor.name}, ${roleWord(role, lang)}`
                    : `${person.neighbor.name}, ${roleWord(role, lang)}`
                }
                onMouseEnter={() => enterPerson(person.neighbor)}
                onFocus={() => enterPerson(person.neighbor)}
                onClick={openPerson}
                onKeyDown={(event: KeyboardEvent) => {
                  if (!canOpen) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onCenter(person.neighbor.id);
                  }
                }}
              />
              {role === "both" ? (
                <path
                  d={diamondPath(x, person.y, radius * 0.62)}
                  fill="var(--bg)"
                  stroke="var(--amber)"
                  strokeWidth={chosen ? 1.8 : 1.4}
                  strokeOpacity={quiet ? 0.35 : 1}
                  className="pointer-events-none"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 font-mono text-[10px] tracking-[0.16em] text-[var(--ink-dim)] uppercase">
        <span className="flex items-center gap-2">
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
          </svg>
          {lang === "es" ? "Actúa" : "Acts"}
        </span>
        <span className="flex items-center gap-2">
          <svg width="14" height="14" aria-hidden="true">
            <path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" fill="none" stroke="var(--amber)" strokeWidth="1.4" />
          </svg>
          {lang === "es" ? "Dirige" : "Directs"}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-6 bg-[var(--blood)]" />
          {lang === "es" ? "Curva de reparto" : "Cast curve"}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-6 bg-[var(--amber)]" />
          {lang === "es" ? "Curva de dirección" : "Direction curve"}
        </span>
      </div>
    </div>
  );
}

export function FilmSheet({
  title,
  year,
  directors,
  cast,
  more,
  pending = false,
  lang,
  filmCount,
  onOpen,
}: {
  title: string;
  year: number | null;
  directors: string[];
  cast: string[];
  more: number;
  pending?: boolean;
  lang: Lang;
  filmCount: (name: string) => number;
  onOpen: (id: string) => void;
}) {
  function credit(name: string, role: PersonRole) {
    const count = filmCount(name);
    const canOpen = count >= 2;
    return (
      <li key={`${role}-${name}`}>
        <button
          type="button"
          className="flex items-center gap-3 py-1.5 text-left"
          onClick={() => {
            if (canOpen) onOpen(name);
          }}
        >
          {role === "director" ? (
            <svg width="16" height="16" aria-hidden="true">
              <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" fill="none" stroke="var(--amber)" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg width="16" height="16" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
            </svg>
          )}
          <span
            className={
              canOpen
                ? "text-lg text-[var(--ink)] underline decoration-[var(--line)] underline-offset-4"
                : "text-lg text-[var(--ink-dim)]"
            }
          >
            {name}
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className="grid gap-8 px-5 py-10 md:grid-cols-[minmax(0,1fr)_minmax(220px,380px)_minmax(0,1fr)] md:px-10">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-[var(--amber)] uppercase">
          {lang === "es" ? "Dirección" : "Directors"}
        </p>
        <ul className="mt-3">{directors.map((name) => credit(name, "director"))}</ul>
      </div>
      <div className="md:text-center">
        <p className="font-mono text-[12px] tracking-[0.14em] text-[var(--ink-dim)]">{year ?? "—"}</p>
        <h2 className="mt-3 font-display text-5xl leading-none text-[var(--ink)] md:text-6xl">{title}</h2>
        <p className="mt-4 text-sm leading-6 text-[var(--ink-dim)]">
          {lang === "es"
            ? "Un nombre subrayado abre su red, con esta película encendida."
            : "An underlined name opens their network, with this film lit."}
        </p>
      </div>
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-[var(--ink-dim)] uppercase">
          {lang === "es" ? "Reparto" : "Cast"}
        </p>
        {cast.length > 0 ? (
          <ul className="mt-3">{cast.map((name) => credit(name, "actor"))}</ul>
        ) : pending ? (
          <p className="mt-3 text-sm text-[var(--ink-dim)]">
            {lang === "es" ? "Abriendo el reparto." : "Opening the cast."}
          </p>
        ) : null}
        {more > 0 ? (
          <p className="mt-3 font-mono text-[11px] tracking-[0.08em] text-[var(--ink-dim)]">
            {lang === "es" ? `y ${more} más` : `and ${more} more`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
