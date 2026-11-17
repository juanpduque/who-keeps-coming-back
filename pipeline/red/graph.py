"""Horror credit graph.

Cast and directors come from one row per film: comma-separated billed names
and a separate directors field. The same spelling is the same person.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from typing import Iterable


Film = dict
KIND_COSTAR = "costar"
KIND_DIRECTED = "directed"

# Exact keyword tokens. TMDB's adult flag misses erotic horror that the file
# still marks adult=false. These tokens name the film as erotic or
# pornographic. "torture porn" and "adult animation" are not in the set:
# the first is a critic's name for violent horror, the second means
# animation made for grown-ups.
ADULT_KEYWORDS = frozenset(
    {
        "erotic",
        "erotic horror",
        "erotic movie",
        "erotic thriller",
        "eroticism",
        "gay erotica",
        "gay hardcore",
        "gay pink film",
        "gay pornography",
        "hentai",
        "nunsploitation",
        "pink film",
        "porno",
        "pornography",
        "sexploitation",
        "softcore",
        "stag film",
    }
)


def is_adult_release(keywords: str | None) -> bool:
    if not keywords:
        return False
    for part in keywords.split(","):
        token = " ".join(part.split()).lower()
        if token in ADULT_KEYWORDS:
            return True
    return False


def normalize_name(name: str) -> str:
    return " ".join(name.split())


def split_names(field: str | None) -> list[str]:
    if not field:
        return []
    seen: set[str] = set()
    names: list[str] = []
    for part in field.split(","):
        name = normalize_name(part)
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names


def _pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def relations_for_film(film: Film) -> list[tuple[str, str, str, str | None]]:
    """Undirected credit events: (a, b, kind, director_name).

    Amber when either person directed that film. Blood only when both are
    billed and neither directed it. Two directors are amber, with no single
    director name.
    """
    roles: dict[str, set[str]] = {}
    for director in film["directors"]:
        roles.setdefault(director, set()).add("director")
    for actor in film["cast"]:
        roles.setdefault(actor, set()).add("actor")

    names = list(roles)
    events: list[tuple[str, str, str, str | None]] = []
    for i, left in enumerate(names):
        for right in names[i + 1 :]:
            left_directs = "director" in roles[left]
            right_directs = "director" in roles[right]
            a, b = _pair(left, right)
            if left_directs or right_directs:
                director = None
                if left_directs and not right_directs:
                    director = left
                elif right_directs and not left_directs:
                    director = right
                events.append((a, b, KIND_DIRECTED, director))
            elif "actor" in roles[left] and "actor" in roles[right]:
                events.append((a, b, KIND_COSTAR, None))
    return events


def _year_key(year: int | None) -> int:
    return year if year is not None else -1


def _film_sort(film: dict) -> tuple:
    return (-_year_key(film.get("year")), film.get("title") or "")


def _edge_rank(edge: dict) -> tuple:
    latest = max((_year_key(film.get("year")) for film in edge["_all"]), default=-1)
    return (edge["weight"], latest, edge["a"], edge["b"])


def _public_films(films: list[dict], limit: int) -> tuple[list[dict], int]:
    ordered = sorted(films, key=_film_sort)
    shown = [
        {"title": film["title"], "year": film["year"], "tconst": film["tconst"]}
        for film in ordered[:limit]
    ]
    return shown, max(0, len(ordered) - len(shown))


def build_graph(films: Iterable[Film], neighbor_cap: int = 24, film_cap: int = 12) -> dict:
    corpus = []
    for film in films:
        cleaned = dict(film)
        cleaned["cast"] = split_names(", ".join(film.get("cast") or []))
        cleaned["directors"] = split_names(", ".join(film.get("directors") or []))
        corpus.append(cleaned)
    person_films: dict[str, set[str]] = defaultdict(set)
    person_actor: dict[str, set[str]] = defaultdict(set)
    person_director: dict[str, set[str]] = defaultdict(set)
    # (a, b, kind) -> tconst -> film record with the director credited on that film
    buckets: dict[tuple[str, str, str], dict[str, dict]] = defaultdict(dict)

    cast_lengths: list[int] = []
    years: list[int] = []

    for film in corpus:
        cast = film["cast"]
        directors = film["directors"]
        cast_lengths.append(len(cast))
        if film.get("year") is not None:
            years.append(film["year"])
        film_id = film["id"]
        for name in cast:
            person_films[name].add(film_id)
            person_actor[name].add(film_id)
        for name in directors:
            person_films[name].add(film_id)
            person_director[name].add(film_id)
        record = {
            "title": film["title"],
            "year": film.get("year"),
            "tconst": film["tconst"],
        }
        for a, b, kind, director in relations_for_film(film):
            slot = buckets[(a, b, kind)].get(film_id)
            if slot is None:
                buckets[(a, b, kind)][film_id] = {**record, "directors": {director} if director else set()}
            elif director:
                slot["directors"].add(director)

    edges: list[dict] = []
    for (a, b, kind), by_film in buckets.items():
        film_rows = []
        credited: set[str] = set()
        for row in by_film.values():
            credited.update(row["directors"])
            film_rows.append(
                {"title": row["title"], "year": row["year"], "tconst": row["tconst"]}
            )
        shown, more = _public_films(film_rows, film_cap)
        edges.append(
            {
                "a": a,
                "b": b,
                "kind": kind,
                "weight": len(by_film),
                "director": next(iter(credited)) if len(credited) == 1 else None,
                "films": shown,
                "more": more,
                "_all": film_rows,
            }
        )

    def summary(edge: dict, limit: int = 4) -> dict:
        shown, more = _public_films(edge["_all"], limit)
        return {
            "a": edge["a"],
            "b": edge["b"],
            "kind": edge["kind"],
            "weight": edge["weight"],
            "director": edge["director"],
            "films": shown,
            "more": more,
        }

    people = []
    for name, ids in person_films.items():
        people.append(
            {
                "id": name,
                "name": name,
                "filmCount": len(ids),
                "asActor": len(person_actor.get(name, ())),
                "asDirector": len(person_director.get(name, ())),
            }
        )
    people_by_id = {person["id"]: person for person in people}

    ranked_edges = sorted(edges, key=_edge_rank, reverse=True)
    opening_edge = ranked_edges[0] if ranked_edges else None

    def center_of(edge: dict) -> str:
        left = people_by_id[edge["a"]]
        right = people_by_id[edge["b"]]
        return max(
            (left, right),
            key=lambda person: (person["filmCount"], person["asDirector"], person["name"]),
        )["id"]

    opening = None
    if opening_edge is not None:
        opening = summary(opening_edge, 8)
        opening["center"] = center_of(opening_edge)

    most_films = sorted(
        people,
        key=lambda person: (-person["filmCount"], -person["asDirector"], person["name"]),
    )[:8]
    top_directed = [summary(edge) for edge in ranked_edges if edge["kind"] == KIND_DIRECTED][:8]
    top_costar = [summary(edge) for edge in ranked_edges if edge["kind"] == KIND_COSTAR][:8]

    by_person: dict[str, list[dict]] = defaultdict(list)
    for edge in edges:
        for person, other in ((edge["a"], edge["b"]), (edge["b"], edge["a"])):
            by_person[person].append(edge | {"other": other})

    egos: dict[str, dict] = {}
    for person in people:
        if person["filmCount"] < 2:
            continue
        incident = sorted(by_person.get(person["id"], []), key=_edge_rank, reverse=True)
        shown = incident[:neighbor_cap]
        neighbors = []
        for edge in shown:
            other = people_by_id[edge["other"]]
            # Story lists stay short. The spine needs every shared film so each
            # credit can be its own curve.
            films, _ = _public_films(edge["_all"], len(edge["_all"]))
            neighbors.append(
                {
                    "id": other["id"],
                    "name": other["name"],
                    "weight": edge["weight"],
                    "kind": edge["kind"],
                    "director": edge["director"],
                    "filmCount": other["filmCount"],
                    "films": films,
                    "more": 0,
                }
            )
        egos[person["id"]] = {
            "id": person["id"],
            "name": person["name"],
            "filmCount": person["filmCount"],
            "asActor": person["asActor"],
            "asDirector": person["asDirector"],
            "omitted": max(0, len(incident) - len(shown)),
            "neighbors": neighbors,
        }

    median_cast = statistics.median(cast_lengths) if cast_lengths else 0
    story = {
        "corpus": {
            "films": len(corpus),
            "people": len(people),
            "medianCast": median_cast,
            "minYear": min(years) if years else None,
            "maxYear": max(years) if years else None,
            "source": "HenryWaltson/TMDB-IMDB-Movies-Dataset",
        },
        "opening": opening,
        "mostFilms": most_films,
        "topDirected": top_directed,
        "topCostar": top_costar,
        "openingEgo": egos.get(opening["center"]) if opening else None,
    }
    searchable = [
        {
            "id": person["id"],
            "name": person["name"],
            "filmCount": person["filmCount"],
        }
        for person in people
        if person["filmCount"] >= 2
    ]
    searchable.sort(key=lambda person: person["name"].casefold())
    return {"story": story, "egos": egos, "search": searchable}
