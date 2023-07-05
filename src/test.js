/* Copyright (C) 2022 Flanders Make - CodesignS */

import Query from './query.js';
import { QueryEngine, features } from './engine.js';
import Predicate from './predicate.js';
import fs from 'fs';

const source = { type: 'sparql', value: 'https://dbpedia.org/sparql' };
const engine = new QueryEngine();

let query = fs.readFileSync('./queries/bond.sparql', 'utf8');

let i = 0;
engine.run(query, { source: source }, data => {
	console.log(data);
	i++;
});
console.log(i + ' result(s)');
