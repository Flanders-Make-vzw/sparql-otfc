/* Copyright (C) 2022 Flanders Make - CodesignS */

import fs from 'fs';
import axios from 'axios';
import chalk from 'chalk';
import N3 from 'n3';
const { DataFactory } = N3;
const { namedNode, literal } = DataFactory;
import Query from './query.js';

export default class Predicate {

	static async substitute(query, context) {
		throw new Error('Substitute not implemented');
	}

	static async compute(query, context, engine) {
		throw new Error('Compute not implemented');
	}

	static read(path) {
		return new Query(fs.readFileSync(path, 'utf8'));
	}

	static merge(q0 /* predicate query */, q1 /* user query */, subject, predicate) {
		// console.log('Extending predicate query with constraints to prevent overfetching\n---\n' + q0.toString().trim() + '\n---');
		console.log('Extending predicate query with constraints to prevent overfetching');
		let v0 = subject, v1 = findVariable(q1, predicate);
		let [ constraints, mappings ] = findConstraints(q0, q1, predicate, v0, v1);
		for (const c of constraints) {
			if (!hasConstraint(q0, c)) {
				let t = {
					subject: { termType: getTermType(c.s), value: c.s },
					predicate: { termType: getTermType(c.p), value: c.p },
					object: { termType: getTermType(c.o), value: c.o }
				};
				q0.addWhereTriples([ t ]);
				console.log(chalk.yellow.bold('Found constraint: ' + formatTriple(t)));
			}
		}
		let filters = findFilters(q0, q1, mappings);
		if (filters.length) {
			q0.addWhereFilters(filters);
			console.log(chalk.yellow.bold('Found filters: ' + filters.length));
		}
		// shortcut to pass limit from user query to predicate query, but is fundamentally incorrect
		if (q1.query.limit) {
			q0.setLimit(q1.query.limit);
			console.log(chalk.yellow.bold('Found limit: ' + q1.query.limit));			
		}
		return q0;
	}

	static iri(n) {
		// return '<' + s + '>';
		return namedNode(n);
	}

	static literal(n) {
		return literal(n)
	}

	static json(o) {
		return JSON.stringify(JSON.stringify(o)) + '^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON>';
	}

	static literalBoolean(b) {
		return (b)? 'true' : 'false';
	}
}

export class RESTComputePredicate extends Predicate {
	// As opposed to the parent class Predicate, the methods are not static.
	// Instead each REST predicate is represented by an instance of this class.
	constructor(restURL, predicateIRI, predicateQuery, predicateQuerySubject, predicateMeta) {
		super();
		this.restURL = restURL;
		this.predicateIRI = predicateIRI;
		this.predicateQuery = predicateQuery;
		this.predicateQuerySubject = predicateQuerySubject;
		this.meta = {};
		try { this.meta = JSON.parse(predicateMeta); } catch {};
	}

	async compute(query, context, engine) {
		let pQuery = new Query(this.predicateQuery);
		let extendedQuery = Predicate.merge(pQuery, query, this.predicateQuerySubject, this.predicateIRI);

		let dataList = [];
		await engine.run(extendedQuery, context, data => {
			// For now, all data is collected and sent in a single REST call for computation.
			// This could be improved significantly by using streaming.
			dataList.push(data);
		});
		// Call the REST server
		let restResponse = await axios.post(`${this.restURL}/compute`, {
			"predicateIRI" : this.predicateIRI,
			"computationInput" : dataList
		});
		let triples = [];  
		const thePredicateIRI = Predicate.iri(this.predicateIRI);
		for (const r of restResponse.data.result) {
			triples.push({ s: Predicate.iri(r.key), p: thePredicateIRI, o: r.value });
		}
		return triples;
	}
}


function formatTriple(t) {
	let s = '';
	s += isVariable(t.subject)? '?' + t.subject.value : '<' + t.subject.value + '>';
	s += ' ';
	s += isVariable(t.predicate)? '?' + t.predicate.value : '<' + t.predicate.value + '>';
	s += ' ';
	s += isVariable(t.object)? '?' + t.object.value : '<' + t.object.value + '>';
	return s;
}

function getTermType(s) {
	try {
   		const url = new URL(s);
   		return (url.protocol === "http:" || url.protocol === "https:")? 'NamedNode' : 'Variable';
  	} catch (_) {
    	return 'Variable';
  	}
}

function isVariable(term) {
	// consider blank nodes as variables
	return term.termType === 'Variable' || term.termType === 'BlankNode';
}

function findVariable(q, predicate) {
	for (const t of q.whereTriples()) {
		if (isVariable(t.subject) && t.predicate.value === predicate) {
			return t.subject.value;
		}
	}
	return;
}

function hasConstraint(q, constraint) {
	for (const t of q.whereTriples()) {
		if (t.subject.value === constraint.s && t.predicate.value === constraint.p && t.object.value === constraint.o) {
			return true;
		}
	}
	return false;
}

function findSubjectMapping(q, predicate, object) {
	for (const t of q.whereTriples()) {
		if (isVariable(t.subject) && t.predicate.value === predicate && t.object.value === object) {
			return t.subject.value;
		}
	}
}

function findObjectMapping(q, subject, predicate) {
	for (const t of q.whereTriples()) {
		if (isVariable(t.object) && t.predicate.value === predicate && t.subject.value === subject) {
			return t.object.value;
		}
	}
}

function findConstraints(q0 /* predicate query */, q1 /* user query */, predicate, v0, v1) {
	let constraints = [], variables = [], mappings = {};
	for (const t of q1.whereTriples()) {
		if (t.predicate.value === predicate) continue;
		if (isVariable(t.subject) && t.subject.value === v1) {
			let o = t.object.value;
			if (isVariable(t.object)) {
				let o0 = findObjectMapping(q0, t.subject.value, t.predicate.value);
				variables.push(o);
				mappings[o] = (o0)? o0 : '_' + o; o = mappings[o];
			}
			constraints.push({ s: v0, p: t.predicate.value, o: o });
		}
		else if (isVariable(t.subject) && variables.includes(t.subject.value)) {
			let o = t.object.value, s = t.subject.value;
			if (isVariable(t.object)) {
				let o0 = findObjectMapping(q0, t.subject.value, t.predicate.value);
				variables.push(o);
				mappings[o] = (o0)? o0 : '_' + o; o = mappings[o];
			}			
			constraints.push({ s: mappings[s]? mappings[s] : s, p: t.predicate.value, o: o });
		}
		else if (isVariable(t.object) && t.object.value === v1) {
			let o = t.object.value, s = t.subject.value;
			if (isVariable(t.subject)) {
				let s0 = findSubjectMapping(q0, t.predicate.value, t.object.value);
				variables.push(s);
				mappings[s] = (s0)? s0 : '_' + s; s = mappings[s];
			}
			constraints.push({ s: s, p: t.predicate.value, o: v0 });
		}
		else if (isVariable(t.object) && variables.includes(t.object.value)) {
			let o = t.object.value, s = t.subject.value;
			if (isVariable(t.subject)) {
				let s0 = findSubjectMapping(q0, t.predicate.value, t.object.value);
				variables.push(s);
				mappings[s] = (s0)? s0 : '_' + s; s = mappings[s];
			}
			constraints.push({ s: s, p: t.predicate.value, o: mappings[o]? mappings[o] : o });
		}
	}
	return [ constraints, mappings ];
}

function findFilters(q0 /* predicate query */, q1 /* user query */, mappings) {
	let filters = [];
	const findExpressions = function(e) {
		let args = [];
		if (e.operator === '&&') {
			for (const a of e.args) {
				const ee = findExpressions(a);
				if (ee) { 
					args.push(ee);
				}
			}
			return (e.args.length == args.length)? { type: e.type, operator: e.operator, args: args } : null;
		}
		else if (e.operator === '||') {
			for (const a of e.args) {
				const ee = findExpressions(a);
				if (ee) {
					args.push(ee);
				}
			}
			return (e.args.length > 0)? { type: e.type, operator: e.operator, args: args } : null; // not sure if || with one arg is allowed
		}
		else {
			for (const a of e.args) {
				if (isVariable(a)) {
					let v = q0.variables().includes(a.value)? a.value : mappings[a.value];
					if (!v) return null; // ignore this expression since the variable is not known in q
					args.push({ termType: a.termType, value: v });
				}
				else {
					args.push(a);
				}
			}
			return { type: e.type, operator: e.operator, args: args };
		}
	}
	for (const e of q1.whereFilters()) {
		const ee = findExpressions(e);
		if (ee) filters.push(ee);
	}
	return filters;
}
