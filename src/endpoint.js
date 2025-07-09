/* Copyright (C) 2022 Flanders Make - CodesignS */

import communica from '@comunica/actor-init-query/lib/HttpServiceSparqlEndpoint.js';
import core_1 from '@comunica/core';
import context_entries_1 from '@comunica/context-entries';
import http from 'http';
import querystring from 'querystring';
import url from 'url';
import negotiate from 'negotiate';
import { ArrayIterator } from 'asynciterator';
import quad from 'rdf-quad';
import config from 'config';
import N3 from 'n3';
import fs from 'fs';
import { QueryEngine, features } from './engine.js';

const invalidateCacheBeforeQuery = false;
const freshWorkerPerQuery = false;
const contextOverride = '';
const port = config.get('otfc.port');
const timeout = config.get('otfc.timeout');
const workers = config.get('otfc.workers');
const sources = config.get('otfc.sources');
const context = {};
const moduleRootPath = process.cwd() + '/node_modules';
const defaultConfigPath = moduleRootPath + '/@comunica/config-query-sparql/config/config-default.json';
const configPath = process.env.COMUNICA_CONFIG ? process.env.COMUNICA_CONFIG : defaultConfigPath;
const options = { defaultConfigPath, configPath, context, invalidateCacheBeforeQuery, freshWorkerPerQuery, contextOverride, moduleRootPath, mainModulePath: moduleRootPath, port, timeout, workers };

class Endpoint extends communica.HttpServiceSparqlEndpoint {

	constructor(options) {
		super(options);
        // init sources
        this.contextSources = {};
        for (const s of sources) {
            switch (s.type) {
            case 'n3':
                this.createN3Store(s.name, s.imports, (store) => this.contextSources[s.name] = store);
                break;
            case 'sparql':
            default:
                this.contextSources[s.name] = { type: 'sparql', value: s.url };
            }
        }
	}

    createN3Store(name, imports, callback) {
        const store = new N3.Store();
        console.log('Created empty triple store \"' + name + '\"');
        if (!imports || !imports.length) {
            return callback(store);
        }
        let n = imports.length;
        for (const i of imports) {
            console.log(i);
            const parser = new N3.Parser(), rdfStream = fs.createReadStream(i);
            parser.parse(rdfStream, (error, quad, prefixes) => {
                if (quad) {
                    store.addQuad(quad);
                }
                else {
                    console.log('Loaded data from ' + i + ' into \"' + name + '\"');
                    n--;
                    callback(store);
                }
                if (error) {
                    console.log(error);
                    n--;
                }
                if (!n) {
                    callback(store);
                }
            });
        }
        // else callback(store);
    }

    async handleRequest(engine, variants, stdout, stderr, request, response) {
        const negotiated = negotiate.choose(variants, request)
            .sort((first, second) => second.qts - first.qts);
        const variant = request.headers.accept ? negotiated[0] : null;
        const mediaType = variant && variant.qts > 2 ? variant.type : null;
        const requestUrl = url.parse(request.url ?? '', true);
        if (requestUrl.pathname === '/' || request.url === '/') {
            stdout.write('[301] Permanently moved. Redirected to /sparql.');
            response.writeHead(301, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_JSON,
                'Access-Control-Allow-Origin': '*',
                Location: `http://localhost:${this.port}/sparql${requestUrl.search || ''}` });
            response.end(JSON.stringify({ message: 'Queries are accepted on /sparql. Redirected.' }));
            return;
        }
        if (request.url === '/probe') {
            const data = await engine.probe();
            response.writeHead(200, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_JSON, 'Access-Control-Allow-Origin': '*' });
            response.end(JSON.stringify(data));
            return;
        }
        if (request.url === '/meta') {
            const data = await engine.meta();
            response.writeHead(200, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_JSON, 'Access-Control-Allow-Origin': '*' });
            response.end(JSON.stringify(data));
            return;
        }
        if (request.url === '/substitute') {
            const data = await parseJSON(request);
            engine.substitute(data.predicate, data.query);
            response.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
            response.end();
            return;
        }        
        if (!requestUrl.pathname || !requestUrl.pathname.endsWith('/sparql')) {
            stdout.write('[404] Resource not found. Queries are accepted on /sparql.\n');
            response.writeHead(404, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_JSON,
                'Access-Control-Allow-Origin': '*' });
            response.end(JSON.stringify({ message: 'Resource not found. Queries are accepted on /sparql.' }));
            return;
        }
        if (invalidateCacheBeforeQuery) {
            await engine.invalidateHttpCache();
        }
        let source = this.contextSources[requestUrl.pathname.substr(1, requestUrl.pathname.length - 8)];
        if (!source && config.has('otfc.defaultSource')) source = { type: 'sparql', value: config.get('otfc.defaultSource') };
        if (!source) {
            stdout.write('[404] No source specified.\n');
            response.writeHead(404, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_JSON,
                'Access-Control-Allow-Origin': '*' });
            response.end(JSON.stringify({ message: 'No source specified.' }));
            return;            
        }
        let queryBody;
        switch (request.method) {
            case 'POST':
                queryBody = await super.parseBody(request);
                await this.writeQueryResult(engine, stdout, stderr, request, response, source, queryBody, mediaType, false, false, this.lastQueryId++);
                break;
            case 'HEAD':
            case 'GET':
                // eslint-disable-next-line no-case-declarations
                const queryValue = requestUrl.query.query;
                queryBody = queryValue ? { type: 'query', value: queryValue, context: undefined } : undefined;
                // eslint-disable-next-line no-case-declarations
                const headOnly = request.method === 'HEAD';
                await this.writeQueryResult(engine, stdout, stderr, request, response, source, queryBody, mediaType, headOnly, true, this.lastQueryId++);
                break;
            case 'OPTIONS':
                response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
                response.end();
                break;
            default:
                stdout.write(`[405] ${request.method} to ${request.url}\n`);
                response.writeHead(405, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_JSON, 'Access-Control-Allow-Origin': '*' });
                response.end(JSON.stringify({ message: 'Incorrect HTTP method' }));
        }
    }

   async runWorker(stdout, stderr) {
        const engine = await this.engine;
        const mediaTypes = await engine.getResultMediaTypes();
        const variants = [];
        for (const type of Object.keys(mediaTypes)) {
            variants.push({ type, quality: mediaTypes[type] });
        }
        const server = http.createServer(this.handleRequest.bind(this, engine, variants, stdout, stderr));
        server.listen(this.port);
        stderr.write(`Server worker (${process.pid}) running on http://localhost:${this.port}/sparql\n`);
        const openConnections = new Set();
        server.on('request', (request, response) => {
            openConnections.add(response);
            response.on('close', () => {
                openConnections.delete(response);
            });
        });
        process.on('message', async (message) => {
            if (message === 'shutdown') {
                stderr.write(`Shutting down worker ${process.pid} with ${openConnections.size} open connections.\n`);
                server.close();
                for (const connection of openConnections) {
                    connection.writeHead(400, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_PLAIN, 'Access-Control-Allow-Origin': '*' });
                    await new Promise(resolve => connection.end('Timed out', resolve));
                }
                process.exit(15);
            }
        });
        process.on('uncaughtException', async (error) => {
            stderr.write(`Terminating worker ${process.pid} with ${openConnections.size} open connections due to uncaught exception.\n`);
            stderr.write(error.stack);
            server.close();
            for (const connection of openConnections) {
                // FIXME: Disabled the following line since it writes headers to a closed connection.
                // Effect occurs e.g. when the client sends request to / instead of to /sparql.
                // This makes the server spin eternally on uncaugt exception.
                // connection.writeHead(400, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_PLAIN, 'Access-Control-Allow-Origin': '*' });
                await new Promise(resolve => connection.end(error.toString(), resolve));
            }
            process.exit(15);
        });
    }

    async writeQueryResult(engine, stdout, stderr, request, response, source, queryBody, mediaType, headOnly, readOnly, queryId) {
        if (!queryBody || !queryBody.value) {
            return this.writeServiceDescription(engine, stdout, stderr, request, response, mediaType, headOnly);
        }
        process.send({ type: 'start', queryId });
        let context = {
            ...this.context,
            ...this.contextOverride ? queryBody.context : undefined,
        };
        if (source) {
            context.sources = [ source ];
        }
        if (readOnly) {
            context = { ...context, [context_entries_1.KeysQueryOperation.readOnly.name]: readOnly };
        }
        let result;
        try {
            result = await engine.query(queryBody.value, context);
            if (result.resultType === 'void') {
                await result.execute();
            }
        }
        catch (error) {
            console.log(error);
            stdout.write('[400] Bad request\n');
            response.writeHead(400, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_PLAIN, 'Access-Control-Allow-Origin': '*' });
            response.end(error.message);
            return;
        }
        if (!mediaType) {
            switch (result.resultType) {
                case 'quads':
                    mediaType = 'application/trig';
                    break;
                case 'void':
                    mediaType = 'simple';
                    break;
                default:
                    mediaType = 'application/sparql-results+json';
                    break;
            }
        }
        response.writeHead(200, { 'content-type': mediaType, 'Access-Control-Allow-Origin': '*' });
        if (headOnly) {
            response.end();
            return;
        }
        let eventEmitter;
        try {
            const { data } = await engine.resultToString(result, mediaType);
            data.on('error', (error) => {
                stdout.write(`[500] Server error in results: ${error.message} \n`);
                if (!response.writableEnded) {
                    response.end('An internal server error occurred.\n');
                }
            });
            data.pipe(response);
            eventEmitter = data;
        }
        catch (err) {
            stdout.write('[400] Bad request, invalid media type\n');
            response.writeHead(400, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_PLAIN, 'Access-Control-Allow-Origin': '*' });
            response.end('The response for the given query could not be serialized for the requested media type\n');
        }
        response.on('close', () => {
            process.send({ type: 'end', queryId });
        });
        this.stopResponse(response, queryId, eventEmitter);
    }

    async writeServiceDescription(engine, stdout, stderr, request, response, mediaType, headOnly) {
        // stdout.write(`[200] ${request.method} to ${request.url}\n`);
        // stdout.write(`      Requested media type: ${mediaType}\n`);
        // stdout.write('      Received query for service description.\n');
        response.writeHead(200, { 'content-type': mediaType, 'Access-Control-Allow-Origin': '*' });
        if (headOnly) {
            response.end();
            return;
        }
        // eslint-disable-next-line id-length
        const s = request.url;
        const sd = 'http://www.w3.org/ns/sparql-service-description#';
        const quads = [
            // Basic metadata
            quad(s, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', `${sd}Service`),
            quad(s, `${sd}endpoint`, '/sparql'),
            quad(s, `${sd}url`, '/sparql'),
            // Features
            quad(s, `${sd}feature`, `${sd}BasicFederatedQuery`),
            quad(s, `${sd}supportedLanguage`, `${sd}SPARQL10Query`),
            quad(s, `${sd}supportedLanguage`, `${sd}SPARQL11Query`),
        ];
        let eventEmitter;
        try {
            // Append result formats
            const formats = await engine.getResultMediaTypeFormats(new core_1.ActionContext(this.context));
            for (const format in formats) {
                quads.push(quad(s, `${sd}resultFormat`, formats[format]));
            }
            // Flush results
            const { data } = await engine.resultToString({
                resultType: 'quads',
                execute: async () => new ArrayIterator(quads),
                metadata: undefined,
            }, mediaType);
            data.on('error', (error) => {
                stdout.write(`[500] Server error in results: ${error.message} \n`);
                response.end('An internal server error occurred.\n');
            });
            data.pipe(response);
            eventEmitter = data;
        }
        catch {
            stdout.write('[400] Bad request, invalid media type\n');
            response.writeHead(400, { 'content-type': communica.HttpServiceSparqlEndpoint.MIME_PLAIN, 'Access-Control-Allow-Origin': '*' });
            response.end('The response for the given query could not be serialized for the requested media type\n');
            return;
        }
        this.stopResponse(response, 0, eventEmitter);
    }
}

function parseJSON(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('error', reject);
        request.on('data', chunk => {
            body += chunk;
        });
        request.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (err) { reject(err); }
        });
    });
}

export default class OTFCEndpoint {
    constructor() {
        this.endpoint = new Endpoint(options);
        this.endpoint.engine = new QueryEngine();
    }

    run() {
        this.endpoint.run(process.stdout, process.stderr);
    }
}

new OTFCEndpoint().run();