/* Copyright (C) 2022 Flanders Make - CodesignS */

import sparqljs from 'sparqljs';
import config from 'config';
import N3 from 'n3';
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;

export default class Query {

	constructor(query) {
		const q = query.replace( /\{\{(.*?)\}\}/g, (x) => config.get(x.substring(2, x.length-2))); // replace {{}} variables
		let parser = new sparqljs.Parser();
		this.query = parser.parse(q);
		this.subqueries = this.subs(this.query);
		this.normalize();
		this.validate();
	}

	validate() {
		if (this.groups().length) {
			// excluding a.o. subqueries
			throw new Error('Validation failed: group patterns are not supported');
		}
		if (this.whereTriples().filter(t => t.predicate.type === 'path').length) {
			// excluding property paths (after normalization)
			throw new Error('Validation failed: property paths are not supported');
		}
	}

	// TODO: normalize subqueries
	normalize() { 
		// simple paths supported: ^path1, path1/path2
		// complex paths not supported: path1|path2, path1*, path1+, path1?, path1{m,n}, path1{n}, path1{m,}, path1{,n}
		// -> these should somehow be translated to CONSTRUCT queries to support data offloading
		for (const q of [ this ].concat(this.subqueries)) {
			const bgp = q.where().filter(w => w.type === 'bgp');
			let id = 0;
			for (let w of bgp) {
				for (let i in w.triples) {
					const t = w.triples[i];
					if (t.predicate.type !== 'path') continue;
		    		if (t.predicate.pathType === '^' && t.predicate.items.length === 1) {
		    			w.triples[i] = { subject: t.object, predicate: t.predicate.items[0], object: t.subject };
					}
					else if (t.predicate.pathType === '/'  && t.predicate.items.length === 2) {
						const bn = { termType: 'BlankNode', value: 'bn_' + id++ };
		    			w.triples[i] = { subject: t.subject, predicate: t.predicate.items[0], object: bn };
		    			w.triples.splice(++i, 0, { subject: bn, predicate: t.predicate.items[1], object: t.object });
					}
				}
			}
		};
	}

	subs(query) {
		let sq = [];
		if (query.where) {
			for (const w of query.where) {
				if (w.queryType === 'SELECT') {
					let q = new Query('');
					q.query = w;
					sq.push(q);
					sq = sq.concat(this.subs(w));
				}
				else if (w.type === 'union') {
					if (w.patterns) {
						for (const p of w.patterns) {
							let q = new Query('');
							q.query = p;
							sq.push(q);
							sq = sq.concat(this.subs(p));
						}						
					}
				}
			}
		}
		return sq;
	}

	type() {
		return this.query.queryType;
	}

	from() {
		let sources = [];
		if (this.query.from) {
			for (const f of this.query.from.default) {
				sources.push(f.value);
			}
		}
		return sources;
	}

	prefixes() {
		return this.query.prefixes;
	}

	variables() {
		let vars = [];
		for (const t of this.whereTriples()) {
			if (t.subject.termType === 'Variable') vars.push(t.subject.value);
			if (t.predicate.termType === 'Variable') vars.push(t.predicate.value);
			if (t.object.termType === 'Variable') vars.push(t.object.value);
		}
		for (const b of this.whereBinds()) {
			vars.push(b.variable);
		}
		return [...new Set(vars)];
	}

	groups() {
		return this.where().filter(w => w.type === 'group');
	}

	where() {
		return this.query.where? this.query.where : [];
	}

	whereTriples() {
		let triples = [];
		const bgp = this.where().filter(w => w.type === 'bgp');
		for (const w of bgp) {
			triples = triples.concat(w.triples);
		}
		return triples;
	}

	removeWhereTriples(triples) {
		const bgp = this.where().filter(w => w.type === 'bgp');
		for (const w of bgp) {
			w.triples = w.triples.filter(t => { return !triples.includes(t); });
		}
	}

	addWhereTriples(triples) {
		let bgp = this.where().filter(w => w.type === 'bgp');
		if (!bgp.length && triples.length) {
			bgp = [ { type: 'bgp', triples: [] } ];
			this.query.where.unshift(bgp[0]);
		}
		for (const w of bgp) {
			// add to first bgp, order should not matter unless OPTIONALs are used in the query
			// https://stackoverflow.com/questions/25131365/sparql-optional-query
			for (const t of triples) {
				w.triples.push(t);
			}
			break;
		}
	}

	whereFilters() {
		let filters = this.where().filter(w => { return w.type === 'filter' });
		return filters.map(f => f.expression);
	}

	whereFiltersContaining(variables, operators) {
		let filters = this.whereFilters();
		return filters.filter(f => {
			let fx = (e) => {
				if (operators.includes(e.operator)) {
					return e.args.every(ee => fx(ee));
				}
				else {
					return e.args.every(a => {
						if (a.args)
							return a.args.every(aa => aa.termType !== 'Variable' || variables.includes(aa.value));
						return a.termType !== 'Variable' || variables.includes(a.value);
					});
				}
			};
			return fx(f);
		});
	}

	whereBinds() {
		return this.where().filter(w => { return w.type === 'bind' });
	}

	addWhereBinds(binds) {
		for (const b of binds) {
			this.query.where.push({ type: 'bind', variable: b.variable, expression: b.expression });
		}
	}

	addWhereFilters(filters) {
		for (const f of filters) {
			this.query.where.push({ type: 'filter', expression: f });
		}		
	}

	setLimit(limit) {
		this.query.limit = limit;
	}

	removeLimit() {
		this.query.limit = undefined;
	}

	toString() {
		let generator = sparqljs.Generator();
		return generator.stringify(this.query);
	}

	setFrom(from) {
		this.query.from = { default: [{ termType: 'NamedNode', value: from }],named: [] };
	}

	removeFrom() {
		this.query.from = undefined;
	}

	setPrefixes(prefixes) {
		this.query.prefixes = prefixes;
	}

	pathToTerm(to) {
		let path = [];
		for (const t of this.whereTriples()) {
			if (t.object.termType === t.object.termType && t.object.value === to.value) {
				path.push(t);
				if (t.subject.termType !== 'NamedNode') {
					path = this.pathToTerm(t.subject).concat(path);
				}
			}
		}
		return path;
	}

	pathFromTerm(from) {
		let path = [];
		for (const t of this.whereTriples()) {
			if (t.subject.termType === from.termType && t.subject.value === from.value) {
				path.push(t);
				if (t.object.termType !== 'NamedNode') {
					path = path.concat(this.pathFromTerm(t.object));
				}
			}
		}
		return path;		
	}

	async federate(predicates, fx) {
		// let from = this.query.from;
		// if (!from || !from.default || from.default.length != 1) {
		// 	throw new Error('Federation not supported: query should contain a single FROM statement');
		// }
		let triples = this.whereTriples(), exclude = [], subjects = [], q = null;
		// for (const q of this.subqueries) {
		// 	char += '_';
		// 	triples = triples.concat(spoofTriples(q.whereTriples(), char)); // spoofing needed as variables used in subqueries can be the same
		// }
		// collect paths that originate from computed predicates
		for (const t of triples) {
			if (predicates.includes(t.predicate.value)) {
				exclude.push(t);
			 	if (t.object.termType !== 'NamedNode') {
					exclude = exclude.concat(this.pathFromTerm(t.object));
				}
				if (t.subject.termType !== 'NamedNode') {
					subjects.push(t.subject.value);
				}
			}
		}
		// choose strategy and adjust in engine.js: 1. (CONSTRUCT, offloading) or 2. (SERVICE, manual federation)
		// 1. collect triples that can be offloaded
		let otriples = triples.filter(t => !exclude.includes(t));
		if (otriples.length) {
			let cq = createConstructQuery(otriples), cqvars = cq.variables();
			cq.setPrefixes(this.prefixes());
			cq.addWhereFilters(this.whereFiltersContaining(cqvars, [ '&&' ]));
			let evars = this.variables().filter(v => !cqvars.includes(v));
			let efilters = this.whereFiltersContaining(evars, [ '&&' ]);
			// if (efilters.length) {
				let qx = createComputedSubjectFilterQuery(exclude, efilters, subjects).toString();
				let bindings = await fx(qx);
				if (bindings) {
					for (const s of subjects) {
						let values = bindings.map(b => { return { termType: 'NamedNode', value: b.get(s).id } });
						let filter = { type: 'operation', operator: 'in', args: [ { termType: 'Variable', value: s }, values ] };
						cq.addWhereFilters([ filter ]);
					}				
				}
			// }
			q = cq.toString();
		}
		// 2. collect remaining triples that require federation
		// let ftriples = triples.filter(t => !predicates.includes(t.predicate.value) && !otriples.includes(t));
		// if (ftriples.length) {
		// 	this.removeWhereTriples(ftriples);
		// 	this.query.where.push({ type: 'service', patterns: [ { type: 'bgp', triples: ftriples } ], name: from.default[0], silent: false });
		// }
		return q;
	}
}

function spoofTriples(triples, char) {
	let spoofed = [];
	for (const t of triples) {
		let ts = { ...t };
		if (t.subject.termType === 'Variable') {
			ts.subject.value = char + t.subject.value;
		}
		if (t.predicate.termType === 'Variable') {
			ts.predicate.value = char + t.predicate.value;
		}
		if (t.object.termType === 'Variable') {
			ts.object.value = char + t.object.value;
		}
		spoofed.push(ts);
	}
	return spoofed;
}

function shorten(iri, prefixes) {
	for (const p in prefixes) {
		if (iri.startsWith(prefixes[p])) {
			return p + ':' + iri.substr(prefixes[p].length);
		}
	}
}

function createConstructQuery(triples) {
	let binds = '';
	// swap blank nodes for variables as they are not allowed in a CONSTRUCT's WHERE
	for (const t of triples) {
		if (t.subject.termType === 'BlankNode') {
			t.subject.termType = 'Variable';
			// binds += `{ BIND(BNODE() AS ?${t.subject.value}) }`;
		}
		if (t.object.termType === 'BlankNode') {
			t.object.termType = 'Variable';
			// binds += `{ BIND(BNODE() AS ?${t.object.value}) }`;
		}
	}
	let q = new Query(`CONSTRUCT {} WHERE { ${binds} }`);
	q.query.template = triples;
	q.addWhereTriples(triples);
	// q.removeFrom();
	return q;
}

function createComputedSubjectFilterQuery(triples, filters, subjects) {
	let q = new Query(`SELECT * WHERE {}`);
	q.addWhereTriples(triples);
	q.addWhereFilters(filters);
	// q.removeFrom();
	return q;
}
