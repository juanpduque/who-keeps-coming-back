"""Build the horror credit graph from the TMDB–IMDb parquet."""

from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

import duckdb

from export_blog import export_blog
from graph import build_graph, is_adult_release, split_names

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / "cache" / "tmdb.parquet"
DATA = ROOT / "data" / "red"
PUBLIC = ROOT / "public" / "red"
PARQUET_URL = (
    "https://huggingface.co/datasets/HenryWaltson/TMDB-IMDB-Movies-Dataset/"
    "resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet"
)

QUERY = """
SELECT
  COALESCE(tconst, '') AS tconst,
  COALESCE(title, '') AS title,
  COALESCE(release_date, '') AS release_date,
  COALESCE(directors, '') AS directors,
  COALESCE("cast", '') AS billed,
  COALESCE(keywords, '') AS keywords
FROM read_parquet(?)
WHERE status = 'Released'
  AND adult = false
  AND list_contains(
    list_transform(str_split(COALESCE(genres, ''), ','), lambda x: trim(x)),
    'Horror'
  )
  AND (
    length(trim(COALESCE(directors, ''))) > 0
    OR length(trim(COALESCE("cast", ''))) > 0
  )
"""


def ensure_parquet() -> None:
    if CACHE.exists() and CACHE.stat().st_size > 1_000_000:
        return
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {PARQUET_URL}")
    urllib.request.urlretrieve(PARQUET_URL, CACHE)


def year_of(release_date: str) -> int | None:
    head = (release_date or "")[:4]
    return int(head) if head.isdigit() else None


def load_films() -> list[dict]:
    ensure_parquet()
    rows = duckdb.connect().execute(QUERY, [str(CACHE)]).fetchall()
    films = []
    seen: set[str] = set()
    dropped_adult = 0
    for tconst, title, release_date, directors, billed, keywords in rows:
        title = " ".join((title or "").split())
        if not title:
            continue
        if is_adult_release(keywords):
            dropped_adult += 1
            continue
        cast = split_names(billed)
        director_names = split_names(directors)
        if not cast and not director_names:
            continue
        year = year_of(release_date)
        film_id = tconst or f"{title}|{year}"
        if film_id in seen:
            continue
        seen.add(film_id)
        films.append(
            {
                "id": film_id,
                "tconst": tconst or film_id,
                "title": title,
                "year": year,
                "directors": director_names,
                "cast": cast,
            }
        )
    print(f"dropped erotic or pornographic keywords {dropped_adult}")
    return films


def shard_key(name: str) -> str:
    return hashlib.sha1(name.encode("utf-8")).hexdigest()[:2]


def write_json(path: Path, payload, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2 if pretty else None)
        handle.write("\n")


def write_public(egos: dict) -> None:
    """One films table plus shards. A single ego file is larger than git can store."""
    catalog: list[list] = []
    index: dict[tuple, int] = {}

    def film_index(film: dict) -> int:
        key = (film["title"], film.get("year"), film["tconst"])
        found = index.get(key)
        if found is None:
            found = len(catalog)
            index[key] = found
            catalog.append([film["title"], film.get("year"), film["tconst"]])
        return found

    shards: dict[str, dict] = {}
    for person_id, ego in egos.items():
        neighbors = []
        for neighbor in ego["neighbors"]:
            neighbors.append(
                [
                    neighbor["name"],
                    neighbor["weight"],
                    "c" if neighbor["kind"] == "costar" else "d",
                    neighbor["director"],
                    neighbor["filmCount"],
                    [film_index(film) for film in neighbor["films"]],
                    neighbor["more"],
                ]
            )
        shards.setdefault(shard_key(person_id), {})[person_id] = [
            ego["filmCount"],
            ego["asActor"],
            ego["asDirector"],
            ego["omitted"],
            neighbors,
        ]

    write_json(PUBLIC / "films.json", catalog)
    shard_dir = PUBLIC / "shards"
    shard_dir.mkdir(parents=True, exist_ok=True)
    for stale in shard_dir.glob("*.json"):
        stale.unlink()
    for key, bucket in shards.items():
        write_json(shard_dir / f"{key}.json", bucket)
    print(f"shards {len(shards)} films {len(catalog)}")


def write_titles(films: list[dict]) -> None:
    """A small title index for the finder, plus one credit shard per film id suffix."""
    catalog = []
    index = []
    credits: dict[str, dict] = {}
    for film in films:
        directors = film["directors"]
        billed = film["cast"][:10]
        extra = max(0, len(film["cast"]) - 10)
        tconst = film["tconst"]
        catalog.append([film["title"], film["year"], tconst, directors, billed, extra])
        index.append([film["title"], film["year"], tconst, directors[0] if directors else ""])
        credits.setdefault(tconst[-2:] if len(tconst) >= 2 else "xx", {})[tconst] = [
            directors,
            billed,
            extra,
        ]
    write_json(PUBLIC / "titles.json", catalog)
    write_json(PUBLIC / "film-index.json", index)
    credit_dir = PUBLIC / "credits"
    credit_dir.mkdir(parents=True, exist_ok=True)
    for stale in credit_dir.glob("*.json"):
        stale.unlink()
    for key, bucket in credits.items():
        write_json(credit_dir / f"{key}.json", bucket)


def main() -> None:
    films = load_films()
    print(f"horror films {len(films)}")
    graph = build_graph(films)
    story = graph["story"]
    print(
        "people",
        story["corpus"]["people"],
        "median cast",
        story["corpus"]["medianCast"],
        "opening",
        story["opening"]["a"] if story["opening"] else None,
        story["opening"]["b"] if story["opening"] else None,
        story["opening"]["weight"] if story["opening"] else None,
    )
    write_json(DATA / "story.json", story, pretty=True)
    write_json(PUBLIC / "search.json", graph["search"])
    write_titles(films)
    write_public(graph["egos"])
    export_blog(story)
    print("wrote", DATA / "story.json")


if __name__ == "__main__":
    main()
