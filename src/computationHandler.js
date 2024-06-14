/* Copyright (C) 2024 Flanders Make - CodesignS */

import sparqljs from 'sparqljs';
import comunica from '@comunica/query-sparql';
import { ActionContext } from '@comunica/core/lib/index.js';
import { LoggerPretty } from '@comunica/logger-pretty';
import engineDefault from '@comunica/query-sparql/engine-default.js';
import N3 from 'n3';
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;
import fs from 'fs';
import path from 'path';
import config from 'config';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import Query from './query.js';
import QueryEngine from './engine.js';
import { RESTComputePredicate } from './predicate.js';

/**
 * This class can perform computations of predicates that occur in a userquery.
 * It refuses to compute predicates that occur in complex path expressions.
 * 
 * Limitations:
 * - Predicate values will be added to a local temporary repo.
 *   If those predicates result in IRIs, no reasoning will be done on their result.
 *   This could be surprising to the user.
 */
export default class ComputationHandler {
    // The SPARQL parser for internal use only.
    _parser;
    _doLog = false;
    _redirects = {};
    _predicatesToCompute = {};

    constructor() {
        this._parser = new sparqljs.Parser();
    }

    async handle(q, context, predicatesToCompute) {
        this._predicatesToCompute = predicatesToCompute;
        let sources = context.sources;
        // https://github.com/comunica/comunica/issues/1003, https://github.com/comunica/comunica/issues/1074
        // work-around
        // if (sources.length == 1 && authSources[sources[0].value])
        // 	context.httpAuth = authSources[sources[0].value];
        // moved auth to otfcFetch()
        if (q.type() === 'SELECT') {
            this.validate(q); // FIXME: this should become less restrictive.

            // then compute predicates, if any
            let [ computed, triples ] = await this.computePredicates(q, context);
            if (computed.length) {
                let store = new N3.Store(); // local memory store, or direct elsewhere
                // context.sources = [ store ];
                if (triples.length) {
                    // let insert = 'INSERT DATA {\n';
                    for (const t of triples) {
                        const s = (t.s.termType)? t.s : literal(t.s), p = (t.p.termType)? t.p : literal(t.p), o = (t.o.termType)? t.o : literal(t.o);
                        store.addQuad(s, p, o);
                        // insert += t.s + ' ' + t.p + ' ' + t.o + '.';
                    }
                    // insert += '}';
                    // console.log(insert);
                    //await engine.queryVoid(insert, context);
                }
                let fx = async (qx) => {
                    return await this.filterComputedSubjects(qx, { sources: [ store ] });
                };
                let qo = await q.federate(computed, fx);
                if (qo) {
                    console.log(chalk.blue.bold('Offloading\n---\n') + qo.toString() + chalk.blue.bold('\n---'));
                    // await offloadTriples(qo, { sources: sources, fetch: otfcFetch }, store);
                    // context.sources = sources;
                    await this.offloadTriples(qo, context, store);
                }
                for (const sq of q.subqueries) {
                    let qo = await sq.federate(computed, fx);
                    if (qo) {
                        console.log(chalk.blue.bold('Offloading\n---\n') + qo.toString() + chalk.blue.bold('\n---'));
                        // context.sources = sources;
                        await this.offloadTriples(qo, context, store);
                    }				
                }

                context.sources = [ store ];
            }
        }
        return [ q.toString(), context ];
    }

    validate(query) {
		if (query.groups().length) {
			// excluding a.o. subqueries
			throw new Error('Validation failed: group patterns are not supported');
		}
		if (query.whereTriples().filter(t => t.predicate.type === 'path').length) {
			// excluding property paths (after normalization)
			throw new Error('Validation failed: property paths are not supported');
		}
	}

    async filterComputedSubjects(q, context) {
        const limit = 10000;
        const engine = new comunica.QueryEngine();
        const bindingsStream = await engine.queryBindings(q, context);
        const bindings = await bindingsStream.toArray({ limit: limit });
        return (bindings.length === limit)? null : bindings;
    }

    async offloadTriples(q, context, store) {
        return new Promise(async (resolve) => {
            const engine = new comunica.QueryEngine();
            const quadStream = await engine.queryQuads(q, context);
            let n = 0;
            quadStream.on('end', () => { console.log(chalk.yellow.bold('Cached ' + n + ' triples')); resolve(); });
            quadStream.on('data', quad => {
                store.add(quad);
                n++;
            });
        });
    }

    async computePredicates(query, context, store) {
        let predicates = Object.keys(this._predicatesToCompute), computed = [], data = [];
        let queries = [ query ].concat(query.subqueries);
        for (const q of queries) {
            for (const t of q.whereTriples()) {
                const p = t.predicate.value;
                if (predicates.includes(p)) {
                    if (!this._predicatesToCompute[p]) throw new Error('No predicate compute function registered for ' + p);
                    console.log(chalk.blue.bold('Resolving <' + p + '>'));
                    let triples = await this._predicatesToCompute[p].compute(q, context, new QueryEngine());
                    console.log(chalk.yellow.bold('Computed ' + triples.length + ' triple(s)'));
                    computed.push(p);
                    data = data.concat(triples);
                }
            }
        }
        return [ computed, data ];
    }
}