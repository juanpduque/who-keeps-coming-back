"""Contrast the TMDB horror credits with IMDb's public dumps.

title.principals.tsv.gz and title.crew.tsv.gz identify people by nconst.
name.basics.tsv.gz turns those ids into names. title.basics.tsv.gz supplies
isAdult, titleType, and genres. The dumps are the daily files from
datasets.imdbws.com and are not committed.

Run from this directory after the four files sit in cache/imdb/:

    python3 contrast_imdb.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

import duckdb

from build import load_films

ROOT = Path(__file__).resolve().parents[2]
IMDB = Path(__file__).resolve().parent / "cache" / "imdb"
OUT = ROOT / "data" / "red" / "imdb_contrast.json"

DUMPS = {
    "basics": IMDB / "title.basics.tsv.gz",
    "crew": IMDB / "title.crew.tsv.gz",
    "principals": IMDB / "title.principals.tsv.gz",
    "names": IMDB / "name.basics.tsv.gz",
}

TARGET_NAMES = {
    "jeff kirkendall",
    "mark polonia",
    "jesus franco",
    "jess franco",
}
CAST_CATEGORIES = {"actor", "actress"}
SAMPLE_LIMIT = 12


def norm_name(name: str) -> str:
    """Fold case, accents, and initials so 'P.J. Soles' matches 'P.J. Soles'."""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    cleaned = re.sub(r"[^a-z0-9]+", " ", stripped.lower())
    return " ".join(cleaned.split())


def close_match(left: str, right: str) -> bool:
    """Exact name, or the same surname and a first name that is an initial or prefix."""
    if left == right:
        return True
    left_tokens = left.split()
    right_tokens = right.split()
    if not left_tokens or not right_tokens or left_tokens[-1] != right_tokens[-1]:
        return False
    first_left, first_right = left_tokens[0], right_tokens[0]
    if first_left == first_right or first_left[0] != first_right[0]:
        return first_left == first_right
    if len(first_left) == 1 or len(first_right) == 1:
        return True
    return first_left.startswith(first_right) or first_right.startswith(first_left)


def matched(name: str, others: set[str], close: bool) -> bool:
    if name in others:
        return True
    if not close:
        return False
    return any(close_match(name, other) for other in others)


def read_tsv(path: Path) -> str:
    return (
        "read_csv(?, delim='\t', header=true, quote='', escape='', "
        "nullstr='\\N', strict_mode=false)"
    )


def require_dumps() -> None:
    missing = [str(path) for path in DUMPS.values() if not path.exists()]
    if missing:
        raise SystemExit("missing IMDb dumps:\n" + "\n".join(missing))


def load_targets(con: duckdb.DuckDBPyConnection) -> list[dict]:
    rows = con.execute(
        f"""
        SELECT nconst, primaryName, birthYear, deathYear, primaryProfession
        FROM {read_tsv(DUMPS['names'])}
        WHERE primaryName ILIKE '%polonia%'
           OR primaryName ILIKE '%kirkendall%'
           OR primaryName ILIKE '%franco%'
        """,
        [str(DUMPS["names"])],
    ).fetchall()
    found = []
    for nconst, primary, birth, death, profession in rows:
        key = norm_name(primary or "")
        if key not in TARGET_NAMES:
            continue
        found.append(
            {
                "nconst": nconst,
                "name": primary,
                "key": key,
                "birthYear": birth,
                "deathYear": death,
                "profession": profession,
            }
        )
    return found


def scan(con: duckdb.DuckDBPyConnection, target_ids: list[str]) -> None:
    con.execute("CREATE TABLE target_ids (nconst VARCHAR)")
    if target_ids:
        con.executemany("INSERT INTO target_ids VALUES (?)", [(n,) for n in target_ids])
    print("scanning title.principals")
    con.execute(
        f"""
        CREATE TABLE principal_hits AS
        SELECT tconst, TRY_CAST(ordering AS INTEGER) AS ordering, nconst, category
        FROM {read_tsv(DUMPS['principals'])}
        WHERE category IN ('actor', 'actress', 'director', 'self')
          AND (
            tconst IN (SELECT tconst FROM films)
            OR nconst IN (SELECT nconst FROM target_ids)
          )
        """,
        [str(DUMPS["principals"])],
    )
    print("scanning title.crew and title.basics")
    con.execute(
        f"""
        CREATE TABLE crew_hits AS
        SELECT tconst, directors
        FROM {read_tsv(DUMPS['crew'])}
        WHERE tconst IN (SELECT tconst FROM films)
           OR tconst IN (SELECT tconst FROM principal_hits)
        """,
        [str(DUMPS["crew"])],
    )
    con.execute(
        f"""
        CREATE TABLE basics_hits AS
        SELECT
          tconst,
          titleType,
          primaryTitle,
          TRY_CAST(isAdult AS INTEGER) AS isAdult,
          TRY_CAST(startYear AS INTEGER) AS startYear,
          genres
        FROM {read_tsv(DUMPS['basics'])}
        WHERE tconst IN (SELECT tconst FROM films)
           OR tconst IN (SELECT tconst FROM principal_hits)
        """,
        [str(DUMPS["basics"])],
    )
    con.execute(
        """
        CREATE TABLE needed_ids AS
        SELECT nconst FROM principal_hits
        WHERE tconst IN (SELECT tconst FROM films)
        UNION
        SELECT nconst FROM target_ids
        UNION
        SELECT trim(unnest(str_split(directors, ','))) AS nconst
        FROM crew_hits
        WHERE tconst IN (SELECT tconst FROM films)
          AND directors IS NOT NULL
        """
    )
    print("scanning name.basics for credited people")
    con.execute(
        f"""
        CREATE TABLE name_hits AS
        SELECT nconst, primaryName
        FROM {read_tsv(DUMPS['names'])}
        WHERE nconst IN (SELECT nconst FROM needed_ids WHERE nconst LIKE 'nm%')
        """,
        [str(DUMPS["names"])],
    )


def horror_genres(genres: str | None) -> bool:
    if not genres:
        return False
    return any(part.strip() == "Horror" for part in genres.split(","))


def summarize(films: list[dict], con: duckdb.DuckDBPyConnection, targets: list[dict]) -> dict:
    basics = {
        tconst: {
            "titleType": title_type,
            "primaryTitle": primary,
            "isAdult": adult,
            "startYear": year,
            "genres": genres,
        }
        for tconst, title_type, primary, adult, year, genres in con.execute(
            "SELECT tconst, titleType, primaryTitle, isAdult, startYear, genres FROM basics_hits"
        ).fetchall()
    }
    names = dict(con.execute("SELECT nconst, primaryName FROM name_hits").fetchall())
    crew: dict[str, list[str]] = {}
    for tconst, directors in con.execute(
        "SELECT tconst, directors FROM crew_hits WHERE directors IS NOT NULL"
    ).fetchall():
        crew[tconst] = [part.strip() for part in directors.split(",") if part.strip().startswith("nm")]
    principals: dict[str, list[tuple[int, str, str]]] = {}
    for tconst, ordering, nconst, category in con.execute(
        "SELECT tconst, ordering, nconst, category FROM principal_hits"
    ).fetchall():
        principals.setdefault(tconst, []).append((ordering if ordering is not None else 9999, nconst, category))

    def label(nconst: str) -> str:
        return norm_name(names.get(nconst) or "")

    title_types: Counter[str] = Counter()
    adult_samples = []
    not_horror_samples = []
    cast_miss_samples = []
    director_miss_samples = []
    director_hits = director_total = 0
    director_close_hits = 0
    cast_hits = cast_total = 0
    cast_close_hits = 0
    films_director_all = films_director_compared = 0
    films_cast_all = films_cast_compared = 0
    films_cast_zero = 0
    first_compared = first_exact = first_close = 0
    our_cast_lengths = []
    imdb_cast_lengths = []
    basics_found = 0
    adult_count = 0
    imdb_horror = 0
    franco_films = []

    for film in films:
        tconst = film["tconst"]
        info = basics.get(tconst)
        if info:
            basics_found += 1
            title_types[info["titleType"] or "unknown"] += 1
            if info["isAdult"] == 1:
                adult_count += 1
                if len(adult_samples) < SAMPLE_LIMIT:
                    adult_samples.append(sample_film(film, info))
            if horror_genres(info["genres"]):
                imdb_horror += 1
            elif len(not_horror_samples) < SAMPLE_LIMIT:
                not_horror_samples.append(sample_film(film, info))
        else:
            title_types["missing_from_basics"] += 1

        our_directors = [norm_name(name) for name in film["directors"] if norm_name(name)]
        our_cast = [norm_name(name) for name in film["cast"] if norm_name(name)]
        our_cast_lengths.append(len(our_cast))
        imdb_directors = {label(nconst) for nconst in crew.get(tconst, [])}
        imdb_directors.discard("")
        people = principals.get(tconst, [])
        imdb_cast_ids = [nconst for _, nconst, category in sorted(people) if category in CAST_CATEGORIES]
        imdb_cast = []
        seen_cast: set[str] = set()
        for nconst in imdb_cast_ids:
            name = label(nconst)
            if name and name not in seen_cast:
                seen_cast.add(name)
                imdb_cast.append(name)
        imdb_cast_lengths.append(len(imdb_cast))

        if our_directors and imdb_directors:
            films_director_compared += 1
            exact = sum(1 for name in our_directors if name in imdb_directors)
            close = sum(1 for name in our_directors if matched(name, imdb_directors, True))
            director_hits += exact
            director_close_hits += close
            director_total += len(our_directors)
            if exact == len(our_directors):
                films_director_all += 1
            elif len(director_miss_samples) < SAMPLE_LIMIT:
                director_miss_samples.append(
                    {
                        **sample_film(film, info),
                        "tmdb": film["directors"][:6],
                        "imdb": [names.get(nconst, nconst) for nconst in crew.get(tconst, [])][:6],
                    }
                )

        if our_cast and imdb_cast:
            films_cast_compared += 1
            theirs = set(imdb_cast)
            exact = sum(1 for name in our_cast if name in theirs)
            close = sum(1 for name in our_cast if matched(name, theirs, True))
            cast_hits += exact
            cast_close_hits += close
            cast_total += len(our_cast)
            if exact == len(our_cast):
                films_cast_all += 1
            if exact == 0:
                films_cast_zero += 1
                if len(cast_miss_samples) < SAMPLE_LIMIT:
                    cast_miss_samples.append(
                        {
                            **sample_film(film, info),
                            "tmdb": film["cast"][:8],
                            "imdb": [names.get(nconst, nconst) for nconst in imdb_cast_ids[:8]],
                        }
                    )
            if our_cast and imdb_cast:
                first_compared += 1
                if our_cast[0] == imdb_cast[0]:
                    first_exact += 1
                if matched(our_cast[0], {imdb_cast[0]}, True):
                    first_close += 1

        if any(name in {"jesus franco", "jess franco"} for name in our_directors):
            franco_films.append(sample_film(film, info))

    by_key: dict[str, list[dict]] = {}
    for person in targets:
        by_key.setdefault(person["key"], []).append(
            {k: person[k] for k in ("nconst", "name", "birthYear", "deathYear", "profession")}
        )
    pair = pair_report(principals, crew, basics, by_key)

    def rate(hit: int, total: int) -> float | None:
        return round(hit / total, 4) if total else None

    def median(values: list[int]) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        mid = len(ordered) // 2
        if len(ordered) % 2:
            return float(ordered[mid])
        return (ordered[mid - 1] + ordered[mid]) / 2

    return {
        "dumpRunDate": "2026-11-14",
        "source": "https://datasets.imdbws.com/",
        "films": len(films),
        "basics": {
            "found": basics_found,
            "missing": len(films) - basics_found,
            "imdbMarkedAdult": adult_count,
            "imdbGenreHorror": imdb_horror,
            "imdbGenreNotHorror": basics_found - imdb_horror,
            "titleTypes": dict(title_types.most_common()),
        },
        "directors": {
            "filmsCompared": films_director_compared,
            "filmsAllNamesFound": films_director_all,
            "nameRecallExact": rate(director_hits, director_total),
            "nameRecallClose": rate(director_close_hits, director_total),
            "names": director_total,
        },
        "cast": {
            "filmsCompared": films_cast_compared,
            "filmsAllNamesFound": films_cast_all,
            "filmsNoNameOverlap": films_cast_zero,
            "nameRecallExact": rate(cast_hits, cast_total),
            "nameRecallClose": rate(cast_close_hits, cast_total),
            "names": cast_total,
            "firstBilledExact": rate(first_exact, first_compared),
            "firstBilledClose": rate(first_close, first_compared),
            "medianTmdbCast": median(our_cast_lengths),
            "medianImdbPrincipalCast": median(imdb_cast_lengths),
        },
        "poloniaKirkendall": pair,
        "francoDirectedInGraph": {
            "count": len(franco_films),
            "imdbMarkedAdult": sum(1 for film in franco_films if film.get("isAdult") == 1),
            "samples": franco_films[:SAMPLE_LIMIT],
        },
        "samples": {
            "imdbMarkedAdult": adult_samples,
            "imdbGenreNotHorror": not_horror_samples,
            "directorMismatch": director_miss_samples,
            "castNoOverlap": cast_miss_samples,
        },
    }


def sample_film(film: dict, info: dict | None) -> dict:
    row = {"tconst": film["tconst"], "title": film["title"], "year": film["year"]}
    if info:
        row["imdbTitle"] = info["primaryTitle"]
        row["titleType"] = info["titleType"]
        row["isAdult"] = info["isAdult"]
        row["genres"] = info["genres"]
    return row


def ids_for(by_key: dict[str, list[dict]], key: str) -> set[str]:
    return {person["nconst"] for person in by_key.get(key, [])}


def pair_report(principals, crew, basics, by_key: dict[str, list[dict]]) -> dict:
    polonia = ids_for(by_key, "mark polonia")
    kirk = ids_for(by_key, "jeff kirkendall")
    polonia_titles = {tconst for tconst, people in principals.items() if any(n in polonia for _, n, _ in people)}
    kirk_titles = {tconst for tconst, people in principals.items() if any(n in kirk for _, n, _ in people)}
    # Crew credits still count when a director is absent from principals.
    for tconst, directors in crew.items():
        if any(nconst in polonia for nconst in directors):
            polonia_titles.add(tconst)
        if any(nconst in kirk for nconst in directors):
            kirk_titles.add(tconst)
    shared = sorted(polonia_titles & kirk_titles)
    directed = []
    for tconst in shared:
        polonia_directs = any(nconst in polonia for nconst in crew.get(tconst, []))
        kirk_acts = any(nconst in kirk and category in CAST_CATEGORIES for _, nconst, category in principals.get(tconst, []))
        info = basics.get(tconst, {})
        if polonia_directs and kirk_acts and horror_genres(info.get("genres")) and info.get("isAdult") != 1:
            directed.append(
                {
                    "tconst": tconst,
                    "title": info.get("primaryTitle"),
                    "year": info.get("startYear"),
                    "titleType": info.get("titleType"),
                }
            )
    return {
        "people": {key: by_key.get(key, []) for key in ("mark polonia", "jeff kirkendall")},
        "sharedPrincipalOrCrewTitles": len(shared),
        "poloniaDirectedKirkendallActedHorror": len(directed),
        "films": directed,
    }


def main() -> None:
    require_dumps()
    films = [film for film in load_films() if str(film["tconst"]).startswith("tt")]
    print(f"tmdb horror films with a tconst {len(films)}")
    con = duckdb.connect()
    con.execute("CREATE TABLE films (tconst VARCHAR PRIMARY KEY)")
    con.execute("BEGIN")
    con.executemany("INSERT INTO films VALUES (?)", [(film["tconst"],) for film in films])
    con.execute("COMMIT")
    targets = load_targets(con)
    print(f"target people {len(targets)}")
    scan(con, [person["nconst"] for person in targets])
    report = summarize(films, con, targets)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("films", "basics", "directors", "cast", "francoDirectedInGraph")}, indent=2))
    print(
        "polonia directed / kirkendall acted, horror, not adult:",
        report["poloniaKirkendall"]["poloniaDirectedKirkendallActedHorror"],
    )
    print("wrote", OUT)


if __name__ == "__main__":
    main()
