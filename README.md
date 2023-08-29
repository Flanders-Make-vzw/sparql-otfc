# SPARQL-OTFC

SPARQL-OTFC extends the SPARQL query language with on-the-fly computations. It enables developers to host special predicates that do not exist in a queried data source yet are computed at runtime. To the end-user asking a query, these predicates behave just like regular predicates.

This framework is built on top of Comunica (https://comunica.dev/) and released under MIT license.

### Demo

[![demo](https://img.youtube.com/vi/OoMhFoYzICg/0.jpg)](https://www.youtube.com/watch?v=OoMhFoYzICg)

### Installation

1. Download and install [Node.js >= v18](https://nodejs.org/en/download/).
 
2. Open a terminal and checkout the sparql-otfc repo: `git clone https://github.com/Flanders-Make-vzw/sparql-otfc.git`

3. To install the endpoint: run `npm install`. This will create a `node_modules` subdirectory in which all required dependencies will be installed.

4. To install the optional web UI:

- Linux or Mac: run `git clone https://github.com/comunica/jQuery-Widget.js.git`, then run `./bin/generate-web-ui.sh`.

- Windows: run `npm install -g @comunica/web-client-generator`, then run `comunica-web-client-generator -s settings.json -q queries -d web`, then copy the file `w/explore.html` into the web folder.

### Configuration

See `config/default.json` for endpoint configuration. By default there are two data sources defined: "dbpedia" (https://dbpedia.org/sparql) and "playground" (an empty in-memory triple store for experimentation). Additional SPARQL endpoints can be added under `sources` with `name`, `url` and optional `authentication` string — the latter expecting a `username:password` format.

See `settings.json` for web UI configuration, i.e. specifying data sources and queries. After changing the configuration, reinstall the web UI as described under step 4 in the "Installation" section. More information can be found [here](https://github.com/comunica/jQuery-Widget.js).

### Running

1. To run the endpoint: `node --no-warnings src/endpoint.js`. Pointing a web browser to `http://localhost:3000` should return a SPARQL service description.

2. To run the web UI: `node --no-warnings src/web.js`. Pointing a web browser to `http://localhost:3001` should show the UI and queries are forwarded by default to an endpoint that is expected to run at `http://localhost:3000`.

#### Via Docker:

Run `docker compose -f docker-compose.yml up`.

### Querying

#### Via the command line:

Send a query using e.g. curl to `http://localhost:3000/[data_source_name]/sparql?query=[the_query]` where `data_source_name` has been configured in `config/default.json`. If no `data_source_name` is specified, the default data source specified in the configuration file will be used.

Example: `curl --data-urlencode "query@queries/bond.sparql" http://localhost:3000/dbpedia/sparql`

#### Via the web UI:

Select a single data source and a query (or type one) and click "Execute query".

### Adding a computed predicate

A predicate should define an `iri` by which it is identified and implement a `compute` function that returns triples. Within this compute function, extra data can first be obtained from a SPARQL endpoint, a relational database, a REST API, ... needed to perform the actual calculations. Computed predicates can be implemented in JavaScript or in Python via an optional REST bridge.

#### JavaScript:

The example below shows an implementation for a `'http://flandersmake.be/otfc/bondActorAge` predicate which defines for a given Bond movie (i.e. the subject) the age of the Bond actor starring in it when it was released (i.e. the object).

```javascript
import Predicate from '../predicate.js';

export default class BondActorAgePredicate extends Predicate {
	static iri = 'http://flandersmake.be/otfc/bondActorAge';

	static async compute(query, context, engine) {
		let q = this.read('./queries/bondActorAge.sparql');
		q = this.merge(q, query, 'film', BondActorAgePredicate.iri);
		let triples = [];  
		await engine.run(q, context, data => {
			let year = data.abstract.match(/(?:^|\s)(\d{4})(?:\s|$)/)[1], age = year - new Date(data.dob).getFullYear();
			triples.push({ s: Predicate.iri(data.film), p: Predicate.iri(BondActorAgePredicate.iri), o: age });
		});
		return triples;
	}
}
```
In this example we first collect the necessary data from DBpedia to be able to perform the calculations, i.e. the date of birth of Bond actors and the release year of Bond movies. This is done via the "predicate query" below.

```sparql
SELECT ?film ?dob ?abstract
WHERE {
	?film dbo:wikiPageWikiLink dbc:James_Bond_films.
	?film rdfs:comment ?abstract.
	?film dbo:starring ?actor.
	dbr:Portrayal_of_James_Bond_in_film dbo:portrayer ?actor.
	?actor dbo:birthDate ?dob.
	FILTER (LANG(?abstract) = 'en')
}
```

To avoid overfetching and computing more than necessary, it is possible to merge the predicate query with the user query (i.e. a SPARQL query composed by a user that includes this computed predicate). In other words, constraints found in that user query are transfered to the predicate such that it e.g. only calculates `bondActorAge` triples for films starring a particular actor.

To deploy the computed predicate, save it under `src/predicates` or a custom predicate directory specified in the configuration file (`config/default.json`) and restart the sparql-otfc endpoint.

Then, the predicate can be used as shown in the example below:

```sparql
SELECT ?name
WHERE {
	?f dbo:wikiPageWikiLink dbc:James_Bond_films.
	?f dbo:starring dbr:Sean_Connery.
	?f fm:bondActorAge ?age.
	?f dbp:name ?name.
	FILTER (?age > 40)
}
```

#### Python:

Predicates implemented in Python are similar to those in JavaScript, see `rest-otfc/python/otfc_python_demo.py` for examples. Python predicates are hosted in their own web server that acts as a REST bridge to the sparql-otfc endpoint. To install and run a Python predicate server, execute the following commands within the `rest-otfc/python` folder:

`pip install -r requirements.txt`

`python otfc_python_demo.py`

Add `"predicatesREST_url": "http://localhost:8008"` to `config/default.json` and restart the sparql-otfc endpoint. 

### Contact

Flanders Make is interested to know if you find this software useful. Please contact us at otfc@flandersmake.be with your use case or questions.
