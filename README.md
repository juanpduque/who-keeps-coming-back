# Quién vuelve a trabajar

Ensayo visual de Pulp Analytics. Pregunta quién se vuelve a contratar en el terror: quién actúa junto a quién, y quién dirige a las mismas personas.

El inglés es el texto base. `?lang=es` cambia al español. El artículo está en [`blog/02-red.md`](blog/02-red.md).

## De dónde sale el reparto

De la columna `cast` de [HenryWaltson/TMDB-IMDB-Movies-Dataset](https://huggingface.co/datasets/HenryWaltson/TMDB-IMDB-Movies-Dataset). Es un texto con nombres separados por coma. La dirección está en `directors`, en la misma fila. No hace falta una clave de TMDB. Letterboxd no se mezcla: una lista más larga en unas películas habría hecho ver más conectado a quien apareciera ahí.

Una película entra si está estrenada, no es adulta y uno de sus géneros es exactamente Horror. La marca `adult` de TMDB no cubre el terror erótico, así que también sale una película cuya palabra clave es, exactamente, cine erótico o pornográfico (`erotic movie`, `softcore`, `sexploitation`, `pink film`, `pornography`, `hentai`, `nunsploitation` y variantes cercanas). Nadie se excluye por su nombre.

## Cómo leer el dibujo

Cada persona tiene una espina de películas, ordenadas por año. La gente queda a los lados, unida por una curva a cada película en la que está. El círculo actúa y el rombo dirige. La sangre es reparto compartido, cuando ninguno de los dos dirige. El ámbar es dirección. Al entrar, el centro es un extremo del vínculo más repetido. Pasar sobre una persona o una película lee los títulos. Un clic en un nombre con al menos dos películas reconstruye la red. El corpus se lee de a una persona o de a una película. El buscador queda fijo arriba: escribe un título y un año, como Halloween 1931 o Scream 1996, y se abre la red de esa película. También abre a cualquier director o actor con dos películas o más. Las listas abren a quien más se repite. Se dibujan como máximo 24 vínculos, con todas sus películas; el resto se cuenta debajo del gráfico.

## Correrlo

```bash
npm install
npm run dev
```

El servidor de desarrollo queda en el puerto 4731.

Para regenerar los datos hace falta Python 3 y DuckDB (`pip install -r pipeline/red/requirements.txt`). El Parquet se descarga solo a `pipeline/red/cache/`, que no se versiona.

```bash
npm run test:graph
npm run graph
```

`test:graph` usa las tres Halloween y no descarga nada. Jamie Lee Curtis queda en ámbar con John Carpenter y con David Gordon Green, y en sangre con Donald Pleasence.
