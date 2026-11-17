import unittest

from graph import build_graph, is_adult_release


def film(tconst, title, year, directors, cast):
    return {
        "id": tconst,
        "tconst": tconst,
        "title": title,
        "year": year,
        "directors": directors,
        "cast": cast,
    }


HALLOWEEN = [
    film(
        "tt0077651",
        "Halloween",
        1978,
        ["John Carpenter"],
        [
            "Donald Pleasence",
            "Jamie Lee Curtis",
            "Nancy Kyes",
            "P.J. Soles",
            "Charles Cyphers",
            "Kyle Richards",
            "Brian Andrews",
            "John Michael Graham",
            "Nancy Stephens",
            "Arthur Malet",
        ],
    ),
    film(
        "tt0373883",
        "Halloween",
        2007,
        ["Rob Zombie"],
        [
            "Malcolm McDowell",
            "Sheri Moon Zombie",
            "William Forsythe",
            "Tyler Mane",
            "Scout Taylor-Compton",
            "Brad Dourif",
            "Danielle Harris",
            "Hanna Hall",
            "Bill Moseley",
            "Daeg Faerch",
        ],
    ),
    film(
        "tt1502407",
        "Halloween",
        2018,
        ["David Gordon Green"],
        [
            "Jamie Lee Curtis",
            "Judy Greer",
            "Andi Matichak",
            "James Jude Courtney",
            "Nick Castle",
            "Haluk Bilginer",
            "Will Patton",
            "Rhian Rees",
            "Jefferson Hall",
            "Toby Huss",
        ],
    ),
]


def neighbor(ego, name, kind):
    matches = [item for item in ego["neighbors"] if item["name"] == name and item["kind"] == kind]
    assert len(matches) == 1, (name, kind, ego["neighbors"])
    return matches[0]


class GraphTests(unittest.TestCase):
    def test_halloween_links_jamie_lee_curtis(self):
        graph = build_graph(HALLOWEEN)
        ego = graph["egos"]["Jamie Lee Curtis"]
        carpenter = neighbor(ego, "John Carpenter", "directed")
        green = neighbor(ego, "David Gordon Green", "directed")
        pleasence = neighbor(ego, "Donald Pleasence", "costar")
        self.assertEqual(carpenter["director"], "John Carpenter")
        self.assertEqual(carpenter["films"][0]["year"], 1978)
        self.assertEqual(green["director"], "David Gordon Green")
        self.assertEqual(green["films"][0]["tconst"], "tt1502407")
        self.assertEqual(pleasence["films"][0]["title"], "Halloween")
        self.assertEqual(pleasence["films"][0]["year"], 1978)
        self.assertEqual(ego["filmCount"], 2)
        kinds = {item["kind"] for item in ego["neighbors"] if item["name"] == "Donald Pleasence"}
        self.assertEqual(kinds, {"costar"})

    def test_billed_director_is_not_also_a_costar(self):
        graph = build_graph(
            [
                film(
                    "tt1",
                    "House",
                    2003,
                    ["Rob Zombie"],
                    ["Rob Zombie", "Sheri Moon Zombie", "Bill Moseley"],
                )
            ]
        )
        directed = {
            tuple(sorted((edge["a"], edge["b"])))
            for edge in graph["story"]["topDirected"]
        }
        costar = {
            tuple(sorted((edge["a"], edge["b"])))
            for edge in graph["story"]["topCostar"]
        }
        pair = ("Rob Zombie", "Sheri Moon Zombie")
        self.assertIn(pair, directed)
        self.assertNotIn(pair, costar)

    def test_two_directors_are_amber(self):
        graph = build_graph(
            [film("tt2", "Pair", 1999, ["Ada Lovelace", "Grace Hopper"], ["Grace Hopper"])]
        )
        ego = graph["egos"].get("Ada Lovelace")
        # each appears once, so no stored ego; the edge still exists in the opening
        self.assertEqual(graph["story"]["opening"]["kind"], "directed")
        self.assertIsNone(graph["story"]["opening"]["director"])
        self.assertIsNone(ego)

    def test_name_whitespace_collapses(self):
        graph = build_graph(
            [
                film("tt3", "One", 1980, ["John Carpenter"], ["Jamie  Lee   Curtis"]),
                film("tt4", "Two", 1981, ["Debra Hill"], [" Jamie Lee Curtis "]),
            ]
        )
        self.assertIn("Jamie Lee Curtis", graph["egos"])
        self.assertEqual(graph["egos"]["Jamie Lee Curtis"]["filmCount"], 2)

    def test_drawn_neighbor_keeps_every_shared_film(self):
        films = [
            film(f"tt{index}", f"Title {index}", 1980 + index, ["Director One"], ["Actor Two"])
            for index in range(15)
        ]
        graph = build_graph(films)
        link = neighbor(graph["egos"]["Director One"], "Actor Two", "directed")
        self.assertEqual(len(link["films"]), 15)
        self.assertEqual(link["more"], 0)
        self.assertEqual(link["films"][0]["year"], 1994)
        opening = graph["story"]["opening"]
        self.assertEqual(len(opening["films"]), 8)
        self.assertEqual(opening["more"], 7)

    def test_neighbor_cap_counts_omitted(self):
        films = []
        for index in range(30):
            films.append(
                film(
                    f"tt{index}",
                    f"Film {index}",
                    1980 + index,
                    ["Anchor Director"],
                    [f"Actor {index:02d}"],
                )
            )
        graph = build_graph(films, neighbor_cap=24)
        ego = graph["egos"]["Anchor Director"]
        self.assertEqual(len(ego["neighbors"]), 24)
        self.assertEqual(ego["omitted"], 6)
        self.assertEqual(ego["asDirector"], 30)
        self.assertEqual(ego["asActor"], 0)

    def test_opening_tie_prefers_the_latest_year(self):
        films = [
            film("a1", "Early", 1990, [], ["Only A", "Only B"]),
            film("a2", "Early 2", 1991, [], ["Only A", "Only B"]),
            film("b1", "Later", 2010, [], ["Only C", "Only D"]),
            film("b2", "Later 2", 2015, [], ["Only C", "Only D"]),
            film("c1", "Extra", 2016, [], ["Only C", "Only E"]),
        ]
        opening = build_graph(films)["story"]["opening"]
        self.assertEqual({opening["a"], opening["b"]}, {"Only C", "Only D"})
        self.assertEqual(opening["weight"], 2)
        self.assertEqual(opening["center"], "Only C")

    def test_erotic_keywords_count_as_adult_films(self):
        self.assertTrue(is_adult_release("vampire, Erotic Movie, murder"))
        self.assertTrue(is_adult_release("softcore"))
        self.assertTrue(is_adult_release("sexploitation"))
        self.assertTrue(is_adult_release("pink film"))
        self.assertTrue(is_adult_release("nunsploitation"))
        self.assertTrue(is_adult_release("gay  hardcore"))
        self.assertFalse(is_adult_release("torture porn, kidnapping"))
        self.assertFalse(is_adult_release("adult animation"))
        self.assertFalse(is_adult_release("hardcore punk"))
        self.assertFalse(is_adult_release("rape, murder"))
        self.assertFalse(is_adult_release(""))
        self.assertFalse(is_adult_release(None))

    def test_median_cast_and_corpus(self):
        story = build_graph(HALLOWEEN)["story"]
        self.assertEqual(story["corpus"]["films"], 3)
        self.assertEqual(story["corpus"]["medianCast"], 10)
        self.assertEqual(story["corpus"]["minYear"], 1978)
        self.assertEqual(story["corpus"]["maxYear"], 2018)


if __name__ == "__main__":
    unittest.main()
