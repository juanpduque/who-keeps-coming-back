"""Spanish essay and a frozen SVG of the opening ego network."""

from __future__ import annotations

import html
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _titles(edge: dict, limit: int = 4) -> str:
    names = []
    for film in edge.get("films") or []:
        year = film.get("year")
        names.append(f"{film['title']} ({year})" if year else film["title"])
    extra = edge.get("more") or 0
    if not names:
        return ""
    shown = ", ".join(names[:limit])
    hidden = extra + max(0, len(names) - limit)
    if hidden:
        return f"{shown} y {hidden} más"
    return shown


def _pair_sentence(edge: dict) -> str:
    if edge.get("kind") == "directed" and edge.get("director"):
        other = edge["b"] if edge["director"] == edge["a"] else edge["a"]
        if edge["director"] not in (edge["a"], edge["b"]):
            other = f"{edge['a']} y {edge['b']}"
            return f"{edge['director']} dirige el vínculo entre {other}"
        return f"{edge['director']} dirige a {other}"
    if edge.get("kind") == "directed":
        return f"{edge['a']} y {edge['b']} se cruzan en la dirección"
    return f"{edge['a']} y {edge['b']} comparten cartel"


def _esc(value: str) -> str:
    return html.escape(value, quote=True)


TOP = 64


def _film_key(film: dict) -> str:
    return film.get("tconst") or f"{film.get('title')}|{film.get('year')}"


def _shorten(text: str, px: float, size: float = 12) -> str:
    limit = max(4, int(px / (size * 0.64)))
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _spine(neighbors: list[dict], width: float) -> dict:
    rows: dict[str, dict] = {}
    for neighbor in neighbors:
        for film in neighbor.get("films") or []:
            key = _film_key(film)
            row = rows.setdefault(key, {"film": film, "people": []})
            if neighbor["name"] not in {person["name"] for person in row["people"]}:
                row["people"].append(neighbor)
    ordered = list(rows.values())

    def sort_key(row: dict) -> tuple:
        year = row["film"].get("year")
        return (year is None, year if year is not None else 0, row["film"].get("title") or "")

    ordered.sort(key=sort_key)
    row_h = 44
    title_size = 15
    name_size = 14
    films = []
    for index, row in enumerate(ordered):
        films.append({**row, "y": TOP + index * row_h})
    longest_title = max([72, *[len(film["film"].get("title") or "") * title_size * 0.64 for film in films]])
    longest_name = max([64, *[len(person["name"]) * name_size * 0.64 for person in neighbors]])
    name_lane = min(200, max(136, longest_name + 32))
    column_w = min(420, 58 + longest_title + 18)
    min_curve = 72
    shortfall = name_lane * 2 + column_w + min_curve * 2 - width
    if shortfall > 0:
        column_w -= min(shortfall, max(0, column_w - 220))
        name_lane -= min(max(0, shortfall - min(shortfall, max(0, column_w - 220))), max(0, name_lane - 100))
    curve_lane = max(16, (width - name_lane * 2 - column_w) / 2)
    column_l = name_lane + curve_lane
    column_r = column_l + column_w
    mid = (len(films) - 1) / 2
    people = []
    for neighbor in neighbors:
        hits = [film for film in films if any(person["name"] == neighbor["name"] for person in film["people"])]
        median = hits[len(hits) // 2] if hits else (films[0] if films else None)
        index = films.index(median) if median in films else 0
        people.append({"neighbor": neighbor, "side": "left" if index <= mid else "right", "y": median["y"] if median else TOP})
    for side in ("left", "right"):
        group = sorted((person for person in people if person["side"] == side), key=lambda item: (item["y"], item["neighbor"]["name"]))
        last = float("-inf")
        for person in group:
            if person["y"] < last + 32:
                person["y"] = last + 32
            last = person["y"]
    bottom = max([TOP, *[film["y"] for film in films], *[person["y"] for person in people]])
    return {
        "films": films,
        "people": people,
        "column_l": column_l,
        "column_r": column_r,
        "column_w": column_w,
        "name_lane": name_lane,
        "height": bottom + 72,
    }


def _role(neighbor: dict, center: str) -> str:
    if neighbor.get("kind") == "costar" or neighbor.get("director") == center:
        return "actor"
    if neighbor.get("director") == neighbor.get("name"):
        return "director"
    return "both"


def _diamond(x: float, y: float, r: float) -> str:
    return f"M {x:.1f} {y - r:.1f} L {x + r:.1f} {y:.1f} L {x:.1f} {y + r:.1f} L {x - r:.1f} {y:.1f} Z"


def _curve(x1: float, y1: float, x2: float, y2: float) -> str:
    mid = (x1 + x2) / 2
    return f"M {x1:.1f} {y1:.1f} C {mid:.1f} {y1:.1f}, {mid:.1f} {y2:.1f}, {x2:.1f} {y2:.1f}"


def export_svg(story: dict, path: Path) -> None:
    """Frozen opening chart. The spine is the year. Each curve is a credit."""
    ego = story.get("openingEgo") or {}
    neighbors = list(ego.get("neighbors") or [])
    center = ego.get("name") or "—"
    directs = ego.get("asDirector") or 0
    acts = ego.get("asActor") or 0
    if directs and acts:
        center_role = "DIRECCIÓN Y REPARTO"
    elif directs:
        center_role = "DIRECCIÓN"
    elif acts:
        center_role = "REPARTO"
    else:
        center_role = ""
    width = 1200
    laid = _spine(neighbors, width)
    height = laid["height"]
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height:.0f}" role="img">',
        f"<title>Red de {_esc(center)}</title>",
        f'<rect width="{width}" height="{height:.0f}" fill="#07080b"/>',
        f'<text x="{laid["column_l"]:.1f}" y="30" fill="#e8e4da" font-family="Arial Narrow, Impact, sans-serif" font-size="22">{_esc(center)}</text>',
        f'<text x="{laid["column_l"]:.1f}" y="48" fill="{"#e5a00d" if directs else "#9a958a"}" font-family="ui-monospace, monospace" font-size="11">{_esc(center_role)}</text>',
        f'<line x1="{laid["column_l"]:.1f}" y1="{TOP - 14}" x2="{laid["column_l"]:.1f}" y2="{laid["films"][-1]["y"] if laid["films"] else TOP}" stroke="#2a2a30"/>',
    ]
    for person in laid["people"]:
        x = laid["name_lane"] if person["side"] == "left" else width - laid["name_lane"]
        color = "#c1121f" if person["neighbor"].get("kind") == "costar" else "#e5a00d"
        for film in laid["films"]:
            if person["neighbor"]["name"] not in {item["name"] for item in film["people"]}:
                continue
            end_x = laid["column_l"] if person["side"] == "left" else laid["column_r"]
            lines.append(
                f'<path d="{_curve(x, person["y"], end_x, film["y"])}" fill="none" stroke="{color}" stroke-opacity="0.45" stroke-width="1.3"/>'
            )
    for film in laid["films"]:
        year = film["film"].get("year")
        year_text = "—" if year is None else str(year)
        title = _shorten(film["film"].get("title") or "", laid["column_w"] - 70, 15)
        y = film["y"]
        lines.append(f'<circle cx="{laid["column_l"]:.1f}" cy="{y:.1f}" r="3.5" fill="#9a958a"/>')
        lines.append(
            f'<text x="{laid["column_l"] + 14:.1f}" y="{y:.1f}" dominant-baseline="middle" fill="#9a958a" '
            f'font-family="ui-monospace, monospace" font-size="11">{_esc(year_text)}</text>'
        )
        lines.append(
            f'<text x="{laid["column_l"] + 58:.1f}" y="{y:.1f}" dominant-baseline="middle" fill="#e8e4da" '
            f'font-family="Georgia, serif" font-size="15">{_esc(title)}</text>'
        )
    for person in laid["people"]:
        x = laid["name_lane"] if person["side"] == "left" else width - laid["name_lane"]
        room = max(36, laid["name_lane"] - 22)
        name = _shorten(person["neighbor"]["name"], room, 14)
        anchor = "end" if person["side"] == "left" else "start"
        text_x = x - 14 if person["side"] == "left" else x + 14
        lines.append(
            f'<text x="{text_x:.1f}" y="{person["y"]:.1f}" text-anchor="{anchor}" dominant-baseline="middle" '
            f'fill="#e8e4da" font-family="Georgia, serif" font-size="14">{_esc(name)}</text>'
        )
        role = _role(person["neighbor"], center)
        y = person["y"]
        if role == "director":
            lines.append(
                f'<path d="{_diamond(x, y, 7)}" fill="#07080b" stroke="#e5a00d" stroke-width="1.5"/>'
            )
        else:
            lines.append(
                f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6.5" fill="#07080b" stroke="#e8e4da" stroke-width="1.5"/>'
            )
        if role == "both":
            lines.append(
                f'<path d="{_diamond(x, y, 4)}" fill="#07080b" stroke="#e5a00d" stroke-width="1.4"/>'
            )
    lines.append(
        f'<text x="32" y="{height - 28:.0f}" fill="#9a958a" font-family="ui-monospace, monospace" font-size="10">'
        "CÍRCULO  actúa     ROMBO  dirige     SANGRE  reparto     ÁMBAR  dirección</text>"
    )
    lines.append("</svg>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def export_markdown(story: dict, path: Path) -> None:
    corpus = story["corpus"]
    opening = story["opening"]
    center = opening["center"]
    partner = opening["b"] if opening["a"] == center else opening["a"]
    kind = "dirección" if opening["kind"] == "directed" else "reparto"
    pitch = (
        f"En los créditos facturados del terror, {center} y {partner} "
        f"coinciden en {opening['weight']} películas. Esta pieza cuenta quién "
        f"vuelve a trabajar con quién, sin mezclar la nota de la película."
    )
    most = "\n".join(
        f"- {person['name']}: {person['filmCount']} películas "
        f"({person['asActor']} como reparto, {person['asDirector']} como dirección)"
        for person in story["mostFilms"]
    )
    directed = "\n".join(
        f"- {_pair_sentence(edge)} — {edge['weight']} películas. {_titles(edge)}"
        for edge in story["topDirected"]
    )
    costar = "\n".join(
        f"- {_pair_sentence(edge)} — {edge['weight']} películas. {_titles(edge)}"
        for edge in story["topCostar"]
    )
    body = f"""# Quién vuelve a trabajar

{pitch}

Por Juan Pablo Duque · Pulp Analytics

El terror parece una multitud. Cada año entran caras nuevas. Si uno se queda en los primeros nombres que este archivo guarda por película —la columna `cast` del dataset TMDB–IMDb, más la columna `directors` de la misma fila— el género se achica. Es un círculo que se vuelve a contratar.

{center} es el centro de la red de apertura porque, entre los dos extremos del vínculo más repetido, es quien acumula más películas. El vínculo con {partner} es de {kind} y pesa {opening['weight']}. Las películas de esa línea: {_titles(opening, 8)}.

![Red de {center}](../public/red/opening.svg)

La espina ordena esas películas por año. La sangre une a quien actuó junto. El ámbar une a quien dirigió con quien estuvo en el cartel. Cada curva es un crédito. El dibujo muestra solo la red de una persona: sus 24 compañeros más repetidos, si es que tiene tantos, y cada película que comparten. El resto se cuenta y no se dibuja.

## Quién acumula más películas

{most}

## Quién dirige a los mismos

{directed}

## Quién comparte el cartel

{costar}

## Mi lectura

Los datos muestran quién vuelve, no por qué. El vínculo más repetido de este corte une a {center} y {partner} en {_titles(opening, 6)}. Si los títulos se parecen, es una serie que conserva a su gente. Si no se parecen, es una compañía que se reúne aunque la película cambie de nombre. Las dos cosas caben en el mismo gráfico.

Esto no es la nómina completa. La mediana de nombres facturados por película es {corpus['medianCast']}. Un extra que cruza el fondo no está. Tampoco hay un id de persona: la misma grafía es la misma persona, y dos personas que se escriben igual se cuentan como una.

## Fuentes y método

{corpus['films']} películas de terror ya estrenadas, con Horror como género exacto, entre {corpus['minYear']} y {corpus['maxYear']}. Quedaron fuera las que TMDB marca como adultas y las que traen una palabra clave exacta de cine erótico o pornográfico: erotic movie, softcore, sexploitation, pink film, pornography, hentai, nunsploitation y variantes cercanas. Una película de terror con una escena sexual se queda. Torture porn se queda: es el nombre de la crítica para el terror violento, no una película para adultos. {corpus['people']} personas. Fuente: {corpus['source']}, columnas `cast` y `directors`. No se mezcló Letterboxd: una lista más larga en unas películas habría inflado a quien apareciera ahí. La espina ordena las películas por año y cada curva es un crédito con uno de los 24 compañeros más repetidos. La página interactiva deja elegir a otra persona y leer los títulos de cada curva.
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def export_blog(story: dict) -> None:
    export_svg(story, ROOT / "public" / "red" / "opening.svg")
    export_markdown(story, ROOT / "blog" / "02-red.md")
