/* Copyright (C) 2022 Flanders Make - CodesignS */

import Predicate from '../predicate.js';

export default class BondActorAgePredicate extends Predicate {
	static iri = 'http://flandersmake.be/otfc/bondActorAge';

	static meta = {}

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