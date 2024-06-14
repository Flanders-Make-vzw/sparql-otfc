/* Copyright (C) 2022 Flanders Make - CodesignS */

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