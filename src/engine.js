/* Copyright (C) 2022 Flanders Make - CodesignS */

import comunica from '@comunica/query-sparql';
import engineDefault from '@comunica/query-sparql/engine-default.js';
import N3 from 'n3';
const { DataFactory } = N3;
import fs from 'fs';
import path from 'path';
import config from 'config';
import { pathToFileURL } from 'url';
import axios from 'axios'; 
import chalk from 'chalk';
import Query from './query.js';
import SubstitutionHandler from './substitutionHandler.js';
import ComputationHandler from './computationHandler.js';
import { RESTComputePredicate } from './predicate.js';

const predicatesToCompute = {};
const predicatesToSubstitute = {};
const authSources = {};
const extensionFunctions = {}

const engine = new comunica.QueryEngine();
const debug = config.get('otfc.debug');

export default class QueryEngine extends comunica.QueryEngine {
	_substitutionHandler;
	_computationHandler;

	constructor(engine = engineDefault()) {
		let actors = engine.mediatorQueryResultSerialize.bus.actors.filter(a => a.name === 'urn:comunica:default:query-result-serialize/actors#sparql-json');
		if (actors.length == 1) actors[0].emitMetadata = false; // avoid metadata being added to a sparql-results-json response
		super(engine);

		this._substitutionHandler = new SubstitutionHandler();
		this._computationHandler = new ComputationHandler();

		let sources = config.get('otfc.sources');
		for (const s of sources) {
			if (s.url && s.authentication)
				authSources[s.url] = s.authentication;
		}
	}

	// override to intercept queries sent to a SPARQL endpoint
	async query(query, context) {
		let q = new Query(query);
		let ctx = context;

		ctx.extensionFunctions = extensionFunctions;
        ctx.httpTimeout = 120_000;
        ctx.fetch = otfcFetch;

		if (Object.keys(predicatesToSubstitute).length > 0) {
			console.log(chalk.blue.bold('Applying substitutions\n---\n') + q.toString() + chalk.blue.bold('\n---'));
			q = new Query(this._substitutionHandler.handle(q.toString(), predicatesToSubstitute));
		}

		if (Object.keys(predicatesToCompute).length > 0) {
			console.log(chalk.blue.bold('Applying computations\n---\n') + q.toString() + chalk.blue.bold('\n---'));
			[ q, ctx ] = await this._computationHandler.handle(q, ctx, predicatesToCompute);
		}

		console.log(chalk.blue.bold('Executing\n---\n') + q + chalk.blue.bold('\n---'));
		const result = super.query(q.toString(), ctx);
		return result;
	}

	// execute a query with predicates to resolve and print the results on stdout
	async run(query, context, callback) {
		return new Promise(async resolve => {
			let q = (query instanceof Query)? query : new Query(query);
			let ctx = context;
	
			ctx.extensionFunctions = extensionFunctions;
			ctx.httpTimeout = 120_000;
			ctx.fetch = otfcFetch;
	
			if (Object.keys(predicatesToSubstitute).length > 0) {
				console.log(chalk.blue.bold('Applying substitutions\n---\n') + q.toString() + chalk.blue.bold('\n---'));
				q = new Query(this._substitutionHandler.handle(q.toString(), predicatesToSubstitute));
			}
	
			if (Object.keys(predicatesToCompute).length > 0) {
				console.log(chalk.blue.bold('Applying computations\n---\n') + q.toString() + chalk.blue.bold('\n---'));
				[ q, ctx ] = await this._computationHandler.handle(q, ctx, predicatesToCompute, extensionFunctions);
			}
	
			console.log(chalk.blue.bold('Executing\n---\n') + q + chalk.blue.bold('\n---'));
			const bindingsStream = await engine.queryBindings(q.toString(), ctx);
			// bindingsStream.on('error', (err) => console.log(err));
			bindingsStream.on('end', resolve);
			bindingsStream.on('data', bindings => {
				let data = {};
				for (const [ key, value ] of bindings) {
					let v = value.value;
					if (value.datatype && value.datatype.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON') {
						v = JSON.parse(v);
					}
					else if (value.datatype && value.datatype.value === 'http://www.w3.org/2001/XMLSchema#decimal') {
						v = parseFloat(v);
					}
					data[key.value] = v;
	  			}
	  			callback(data);
			});
		});
	}

	async probe() {
		return probe();
	}

	async meta() {
		return meta();
	}

	async addSubstitutePredicate(predicate, query) {
		console.log('Added substitute query for predicate <' + predicate + '>');
		predicatesToSubstitute[predicate] = {
			substitutionQuery: query
		}
	}
}

async function loadPredicates() {
	await loadJSPredicates();
	await loadPythonPredicates();
}

async function loadJSPredicates() {
	if (config.has('otfc.predicatesPath')) {
		const predicatesPath = config.get('otfc.predicatesPath')
		console.log(`Loading predicates from '${predicatesPath}'`);
		try {
			let p = path.resolve(predicatesPath);
			for (const f of fs.readdirSync(p)) {
				if (!f.endsWith('.js')) { // ignore swap files
					continue;
				}
				try {
					let mod = await import(pathToFileURL(path.join(p, f)));
					if (mod.default.hasOwnProperty('substitutionQuery')) {
						predicatesToSubstitute[mod.default.iri] = mod.default.substitutionQuery;
						console.log('Loaded substitute predicate plugin for <' + mod.default.iri + '>');
					}
					else if (mod.default.hasOwnProperty('compute')) {
						predicatesToCompute[mod.default.iri] = mod.default;
						console.log('Loaded compute predicate plugin for <' + mod.default.iri + '>');			
					}
				}
				catch (error) {
					console.log(`Warning: unable to load predicate from ${path.join(p, f)}`);
					console.log(error);
				}
			}
		} catch (error) {
			console.log(`Warning: unable to load any predicates from this location. Source ignored.`);
		}
	}
}

async function loadPythonPredicates() {
	if (config.has('otfc.predicatesREST_url')) {
		const restUrl = config.get('otfc.predicatesREST_url')
		console.log(`Loading predicates from REST URL '${restUrl}'`);
		let contacted = false;
		let retries = 3;
		while (!contacted && retries > 0) {
			retries -= 1;
			try {
				// TODO: migrate to "fetch" since this is the standard way to go for node >= 18.
				const response = await axios.get(`${restUrl}/predicates`);
				const predicateList = response.data;
				predicateList.forEach(p => {
					switch (p.predicateKind) {
						case 'compute':
							let predicate = new RESTComputePredicate(restUrl, p.predicateIRI, p.predicateQuery, p.predicateQuerySubject, p.predicateMeta);
							predicatesToCompute[p.predicateIRI] = predicate;
							console.log('Loaded compute predicate plugin for <' + p.predicateIRI + '>');			
							break;
						case 'substitute':
							console.log(`Predicate substitution not supported yet for '${p.predicateIRI}'.`)
							break;
						default:
					}
				});
				contacted = true;
			} catch (error) {
				console.log(`Warning: failed to contact location (remaining retries: ${retries})`);
				console.log(error.cause);
			}
			// Wait some time before retrying
			if (retries > 0) {
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}
		if (!contacted) {
			console.log(`Warning: unable to load any predicates from this location. Source ignored.`);
		}
	}
}

async function loadExtensionFunctions() {
	// TODO: dynamically load from file similar to predicates
}

async function meta() {
	let data = [];
	for (const iri in predicatesToSubstitute) {
		data.push({ iri: iri, meta: predicatesToSubstitute[iri].meta || {} });
	}
	for (const iri in predicatesToCompute) {
		data.push({ iri: iri, meta: predicatesToCompute[iri].meta || {} });
	}
	return data;
}

async function probe() {
	const prefixes = config.get('otfc.prefixes');
	const shorten = (v => {
		for (const p in prefixes) {
			if (v.startsWith(prefixes[p])) {
				return p + ':' + v.substr(prefixes[p].length);
			}
		}
		return 'http://'; // blank node?
	});
	const engine = new comunica.QueryEngine();
	const source = config.get('otfc.defaultSource');
	const context = { sources: [ { type: 'sparql', value: source } ], fetch: otfcFetch };
	// ontop does not support FILTER NOT EXISTS, OPTIONAL as workaround
	const q1 =
	`SELECT DISTINCT ?subject ?predicate ?other
	 WHERE {
  		?s a ?subject .
  		?s ?predicate ?o .
		OPTIONAL {
			?s a ?other .
        	?other rdfs:subClassOf ?subject .
			FILTER (?other != ?subject)
  		}
	}`;
	const q2 =
	`SELECT DISTINCT ?predicate ?object ?other
	 WHERE {
  		?o a ?object .
  		?s ?predicate ?o .
 		OPTIONAL {
			?o a ?other .
        	?other rdfs:subClassOf ?object .
			FILTER (?other != ?object)
  		}
	}`;
	const bindingsStream1 = await engine.queryBindings(q1, context);
	const bindingsStream2 = await engine.queryBindings(q2, context);
	const bindings1 = await bindingsStream1.toArray();
	const bindings2 = await bindingsStream2.toArray();

	let subjects = [], predicates = [], objects = [], subjectMappings = {}, objectMappings = {};

	for (const b of bindings1) {
		const s = shorten(b.get('subject').value);
		if (s.startsWith('http://')) continue;
		if (!subjects.includes(s)) subjects.push(s);
		const p = shorten(b.get('predicate').value);
		if (!p.startsWith('http://')) {
			if (!predicates.includes(p)) predicates.push(p);
			if (!b.get('other')) {
				if (!subjectMappings[s]) subjectMappings[s] = [];
				if (!subjectMappings[s].includes(p)) subjectMappings[s].push(p);
			}
		}
	}
	for (const b of bindings2) {
		const o = shorten(b.get('object').value);
		if (o.startsWith('http://')) continue;
		if (!objects.includes(o)) objects.push(o);
		const p = shorten(b.get('predicate').value);
		if (!p.startsWith('http://')) {
			if (!predicates.includes(p)) predicates.push(p);
			if (!b.get('other')) {
				if (!objectMappings[o]) objectMappings[o] = [];
				if (!objectMappings[o].includes(p)) objectMappings[o].push(p);
			}
		}
	}
	subjects.sort(); predicates.sort(); objects.sort();
	return { subjects: subjects, predicates: predicates, objects: objects, subjectMappings: subjectMappings, objectMappings: objectMappings };
}

let _redirects = {};

function otfcFetch(input, options) {
	let url = _redirects[input]? _redirects[input] : input;
	if (authSources[url]) {
		if (!options) { options = {}; }
		if (!options.headers) { options.headers = {} }
		if (!options.headers.authorization) { options.headers.authorization = 'Basic ' + Buffer.from(authSources[url]).toString('base64'); }
	}
	if (options && options.body) {
		const query = (options.body.get)? options.body.get('query') : options.body;
		// const controller = new AbortController(); -> disable timeouts
		// options.signal = controller.signal;
		return new Promise((resolve, reject) => {
			let start = Date.now();
			fetch(url, options).then(res => {
				const diff = Math.round((Date.now() - start) / 1000 * 10) / 10, error = res.status != 200;
				let m = (error)? res.status + ' error' : diff + 's';
				if (error || diff > 1 || debug)
					console.log('Forwarded to <' + input + '> (' + m + ')\n---\n' + query + '\n---');
				resolve(res);
			}).catch(err => {
				console.log('Forwarded to <' + input + '> (error)\n---\n' + query + '\n---');
				console.log(err);
				reject(err);
			});
		});
	}
	else if (!input.endsWith('/sparql')) {
		// advanced hacking to mediate between e.g. GraphDB not sticking to SPARQL end-point specs and Comunica expecting an end-point to end with /sparql
		url = input + '/sparql';
		_redirects[url] = input;
		// console.log(input, options);
		return new Promise(resolve => {
			// impersonate our own end-point for a non-compliant one
			const me = 'http://localhost:' + config.get('otfc.port') + '/sparql';
			fetch(me, options).then(res => {
				// Comunica will use the response url to fire subsequent queries, hack it in
				const key = Reflect.ownKeys(res).find(key => key.toString() === 'Symbol(state)');
				res[key].urlList = [ new URL(url) ];
				resolve(res);
			});
		});
	}
	return fetch(input, options);
}

await loadPredicates();
await loadExtensionFunctions();

const features = {
	virtualPredicates: Object.keys(predicatesToSubstitute).concat(Object.keys(predicatesToCompute)).sort(),
	extensionFunctions: extensionFunctions
};
export { QueryEngine, features };
