# SPARQL-OTFC

SPARQL-OTFC extends the SPARQL query language with on-the-fly computations. It enables developers to host special predicates that do not exist in a queried data source yet are computed at runtime. To the end-user asking a query, these predicates behave just like regular predicates.

This framework is built on top of Comunica (https://comunica.dev/) and released under MIT license.

### Demo

[![demo](https://img.youtube.com/vi/OoMhFoYzICg/0.jpg)](https://www.youtube.com/watch?v=OoMhFoYzICg)

### Installation

1. Download and install [Node.js](https://nodejs.org/en/download/). You need at least v18 (not compatible with v16 or below).
 
2. Open a terminal and checkout the sparql-otfc repo: `git clone https://github.com/Flanders-Make-vzw/sparql-otfc.git`

3. To install the endpoint: run `npm install`. This will create a `node_modules` subdirectory in which all required dependencies will be installed.

4. To install the optional web UI:

- Run `git clone https://github.com/comunica/jQuery-Widget.js.git`
- Run `./bin/generate-web-ui.sh` (Linux or Mac) or `./bin/generate-web-ui.bat` (Windows).

### Configuration

See `config/default.json` for endpoint configuration. By default there are two data sources defined: "dbpedia" (https://dbpedia.org/sparql) and "playground" (an empty in-memory triple store for experimentation). Additional SPARQL endpoints can be added under `sources` with `name`, `url` and optional `authentication` string — the latter expecting a `username:password` format.

See `settings.json` for web UI configuration, i.e. specifying data sources and queries. After changing the configuration, reinstall the web UI as described under step 4 in the "Installation" section. More information can be found [here](https://github.com/comunica/jQuery-Widget.js).

### Running

1. To run the endpoint: run `node --no-warnings src/endpoint.js` in a terminal. Pointing a web browser to `http://localhost:3000` should return a SPARQL service description.

2. To run the web UI: run `node --no-warnings src/web.js` in another terminal. Pointing a web browser to `http://localhost:3001` should show the UI and queries are forwarded by default to an endpoint that is expected to run at `http://localhost:3000`.

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

### Adding a substitution predicate

For scenarios where it is desireable to simplify SPARQL queries without a need for complex computations, we support substituted predicates. Instead of a `compute` function, these predicates implement a `substitutionQuery` variable. That variable contains the textual query that replaces every occurrence of the predicate. 

In the example below, the `http://flandersmake.be/otfc/bondActor` predicate will get replaced by the substitutionQuery and therefore acts as a shorthand for these DBpedia expressions. Note that the variables `?_s` and `?_o`  are reserved here to connect with the subject and object of the `bondActor` predicate when used in a query.

```javascript
import Predicate from '../predicate.js';

export default class BondActorPredicate extends Predicate {
	static iri = 'http://flandersmake.be/otfc/bondActor';

	static substitutionQuery = `
		PREFIX dbo: <http://dbpedia.org/ontology/>
		PREFIX dbr: <http://dbpedia.org/resource/>
		PREFIX dbp: <http://dbpedia.org/property/>
		PREFIX dbc: <http://dbpedia.org/resource/Category:>
		SELECT *
		WHERE {
			?_s dbo:wikiPageWikiLink dbc:James_Bond_films.
			?_s dbo:starring ?_o.
			dbr:Portrayal_of_James_Bond_in_film dbo:portrayer ?_o.
		}
	`;
}
```

This allows to answer queries such as:

```sparql
PREFIX dbo: <http://dbpedia.org/ontology/>
PREFIX dbr: <http://dbpedia.org/resource/>
PREFIX dbp: <http://dbpedia.org/property/>
PREFIX dbc: <http://dbpedia.org/resource/Category:>
PREFIX fm: <http://flandersmake.be/otfc/>
SELECT ?name
WHERE {
	?f fm:bondActor dbr:Sean_Connery.
	?f dbp:name ?name.
}
```

Substituted precicates can also be added dynamically via a REST API. The example below illustrates how a predicate `iri` and a substitute `query` are posted to a `substitute` REST API endpoint.

```javascript
const response = await fetch('http://localhost:3000/substitute', {
    method: 'post',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
    	predicate: 'http://flandersmake.be/otfc/bondActor',
    	query: fs.readFileSync('./queries/bondActor.sparql', 'utf8')
    })
});
```

Depending on the substitution query's complexity OTFC performs the substitution in different ways:
* Queries without group by, order by or limit are typically inlined.
* Queries using group by, order by or limit cannot be inlined. They will be substituted as subqueries. This means that they will get executed _before_ the other parts of the query (see https://www.w3.org/TR/sparql11-query/#subqueries). As with any normal subquery, this may cause performance issues. 

### Limitations

* The presence of computed predicates for now strongly limits the allowed complexity of the user queries.
  It will refuse to answer for instance user queries that contain grouping, or a bit more complex path expressions.
  Substitution queries do not have this limitation. If you want to enjoy the stronger abilities of the substitution queries, you should therefore not specify any compute queries. Allowing the same flexibility for compute queries is on our todo list.

### Contact

Flanders Make is interested to know if you find this software useful. Please contact us at otfc@flandersmake.be with your use case or questions.
