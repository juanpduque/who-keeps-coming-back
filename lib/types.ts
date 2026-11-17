export type FilmCredit = {
  title: string;
  year: number | null;
  tconst: string;
};

export type LinkKind = "costar" | "directed";

export type CreditEdge = {
  a: string;
  b: string;
  kind: LinkKind;
  weight: number;
  director: string | null;
  films: FilmCredit[];
  more: number;
  center?: string;
};

export type PersonStat = {
  id: string;
  name: string;
  filmCount: number;
  asActor: number;
  asDirector: number;
};

export type Neighbor = {
  id: string;
  name: string;
  weight: number;
  kind: LinkKind;
  director: string | null;
  filmCount: number;
  films: FilmCredit[];
  more: number;
};

export type Ego = {
  id: string;
  name: string;
  filmCount: number;
  asActor: number;
  asDirector: number;
  omitted: number;
  neighbors: Neighbor[];
};

export type Story = {
  corpus: {
    films: number;
    people: number;
    medianCast: number;
    minYear: number | null;
    maxYear: number | null;
    source: string;
  };
  opening: (CreditEdge & { center: string }) | null;
  mostFilms: PersonStat[];
  topDirected: CreditEdge[];
  topCostar: CreditEdge[];
  openingEgo: Ego | null;
};

export type SearchHit = {
  id: string;
  name: string;
  filmCount: number;
};
