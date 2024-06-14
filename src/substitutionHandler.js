/* Copyright (C) 2024 Flanders Make - CodesignS */

import sparqljs from 'sparqljs';
import * as Algebra from 'sparqlalgebrajs';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';

/**
 * This class can perform substitution of predicates that occur in a userquery.
 * It refuses to replace predicates that occur in complex path expressions.
 * FIXME: It could be useful to relax this for pathReplacements (a predicate that can be replaced by just a path).
 */
export default class SubstitutionHandler {
    // The SPARQL parser for internal use only.
    _parser;
    _doLog = false;

    constructor() {
        this._parser = new sparqljs.Parser();
    }

    /**
     * Method performs all substitutions on the provided userQuery.
     * @param {string} userQuery - The original user query in SPARQL
     * @param {Object} predicatesToSubstitute - The Object containing predicates to substitute
     * @returns {string} the original userQuery in SPARQL format, with all substitutions performed.
     */
    handle(userQuery, predicatesToSubstitute) {
        // Convert the userQuery to algebraic form
        const parsedUQ = this._parser.parse(userQuery);
        const algebraUQ = Algebra.translate(parsedUQ);

        // Walk over the algebra and perform substitutions
        this._doSubstitute(algebraUQ, predicatesToSubstitute);

        return Algebra.toSparql(algebraUQ);
    }

    /**
     * Method intended to be called recursively in order to walk over the full algebraic structure of the query.
     * This method modifies the provided algebra in place (so modifies the provided algebra).
     * @param {Algebra} algebra - The algebra of the user query (being modified in place!)
     * @param {Object} predicatesToSubstitute - The Object containing predicates to substitute
     * @param {string} contextMsg - A context msg for clarifying errors.
     * @returns {void}
     */
    _doSubstitute(algebra, predicatesToSubstitute, contextMsg) {
        if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: Handling '${algebra.type}'`));
        switch (algebra.type) {
            case 'bgp':
                {
                    const convertedElement = this._handleBGP(algebra, predicatesToSubstitute)
                    if (!convertedElement) {
                        // No conversion was required. Keep as is.
                    } else {
                        // Replace the current algebra with the convertedElement
                        // Pure assignment will not work (only local reference would change).
                        // algebra = convertedElement;

                        // Clear existing properties
                        for (let key in algebra) {
                            if (algebra.hasOwnProperty(key)) {
                                delete algebra[key];
                            }
                        }

                        // Assign new properties
                        Object.assign(algebra, convertedElement);

                        // Re-handle the algebra on the current level (it changed and might need additional replacements).
                        this._doSubstitute(algebra, predicatesToSubstitute)
                    }
                };
                break;
            case 'join':
                {
                    // Joins need to be handled on this level.
                    // They might carry bgp blocks that would result in an additional join level
                    // while that element could easily be added to this join.

                    // Does the join contain any members that are BGP's that require handling?
                    let i = 0;
                    while (i < algebra.input.length) {
                        const currentElement = algebra.input[i];
                        if (currentElement.type === 'bgp') {
                            const convertedElement = this._handleBGP(currentElement, predicatesToSubstitute)
                            if (!convertedElement) {
                                // No conversion was required. Keep as is.
                            } else if (convertedElement.type === 'join') {
                                // Add this join's members to the current algebra.input, instead of the current element.
                                algebra.input.splice(i, 1, ...convertedElement.input);

                                // Keep the loop as of this element, since it may now be another BGP that requires replacement.
                                i--;
                            } else {
                                // The convertedElement is another type of object.
                                // Replace the current element with it.
                                algebra.input.splice(i, 1, convertedElement);
                                i--;
                            }
                        } else {
                            // This is another kind of element, so handle it.
                            this._doSubstitute(currentElement, predicatesToSubstitute);
                        }

                        // Go to the next element
                        i++;
                    }
                };
                break;
            case 'leftjoin':
                {
                    // The leftjoin has to be handled by considering both sides independently.
                    // It is not similar to a join, where any substitutions can be added to the main leftjoin.
                    this._doSubstitute(algebra.input[0], predicatesToSubstitute);
                    this._doSubstitute(algebra.input[1], predicatesToSubstitute);
                }
                break;
            case 'filter':
                {
                    // Filters have an input and an expression.
                    this._doSubstitute(algebra.input, predicatesToSubstitute);

                    // The expression can be nested, handle it as a seperate algebraic element
                    this._doSubstitute(algebra.expression, predicatesToSubstitute);
                }
                break;
            case 'expression':
                {
                    if (algebra.expressionType === 'operator') {
                        // An operator has arguments. Process all arguments
                        for (let arg of algebra.args) {
                            this._doSubstitute(arg, predicatesToSubstitute);
                        }
                    } else if (algebra.expressionType === 'existence') {
                        // Substitutions can only happen in expressions of type 'existence'
                        this._doSubstitute(algebra.input, predicatesToSubstitute);
                    } else if (algebra.expressionType === 'term') {
                        // Nothing required for terms
                    } else {
                        if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: Unsupported expression type '${algebra.expressionType}'`));
                    }
                }
                break;
            case 'path':
                {
                    // The fact that the algebra still contains a path, means that the path could not be expanded automatically.
                    // Any occurrence of a substitution predicate in here is illegal.
                    const predicate = algebra.predicate;
                    const predicateType = predicate.type;
                    if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: handling path type '${predicateType}'`));
                    this._doSubstitute(predicate, predicatesToSubstitute, predicateType);
                }
                break;
            case 'link':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: handling path type 'link'`));
                    if (algebra.iri.value in predicatesToSubstitute) {
                        throw Error(`Substitution of predicate ${algebra.iri.value} is not possible in path with '${contextMsg}'.`);
                    }
                }
                break;
            case 'inv':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: handling path type 'inv'`));
                    this._doSubstitute(algebra.path, predicatesToSubstitute, 'inv ^');
                }
                break;
            case 'alt':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: handling path type 'alt'`));
                    let i = 0;
                    while (i < algebra.input.length) {
                        this._doSubstitute(algebra.input[i], predicatesToSubstitute, 'alt |');
                        i++;
                    }
                }
                break;
            case 'seq':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: handling path type 'seq'`));
                    let i = 0;
                    while (i < algebra.input.length) {
                        this._doSubstitute(algebra.input[i], predicatesToSubstitute, 'seq /');
                        i++;
                    }
                }
                break;
            case 'ZeroOrMorePath':
            case 'OneOrMorePath':
            case 'ZeroOrOnePath':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: handling path type '${algebra.type}'`));
                    this._doSubstitute(algebra.path, predicatesToSubstitute, algebra.type);
                }
                break;
            default:
                {
                    // All other elements can be handled easily
                    if (this._doLog) console.log(chalk.blue.bold(`_doSubstitute: default handling of '${algebra.type}'`));
                    if (algebra.input) {
                        this._doSubstitute(algebra.input, predicatesToSubstitute);
                    } else {
                        // No handling required at anymore
                    }
                }
        }
    }

    /**
     * Method accepts a BGP element. If one of its patterns needs substitution,
     * it converts the BGP into a JOIN having two members:
     *   - the remaining BGP patterns (if any)
     *   - the substitutionQuery appropriately adjusted
     * This method always only handles one replacement at a time!
     * @param {Algebra} bgpElement - The algebraic representation of a BGP element
     * @param {Object} predicatesToSubstitute - The Object containing predicates to substitute
     * @returns {Algebra} A new replacement algebra or undefined if nothing has been changed.
     */
    _handleBGP(bgpElement, predicatesToSubstitute) {
        let replacedPattern = {};
        let i = 0;
        while (i < bgpElement.patterns.length) {
            const currentPattern = bgpElement.patterns[i];

            // Does it need substitution?
            if (currentPattern.predicate.value in predicatesToSubstitute) {
                try {
                    let substitutionQuery = predicatesToSubstitute[currentPattern.predicate.value];

                    // Remove the current pattern from the bgpElement
                    bgpElement.patterns.splice(i,1);

                    // Then determine the substitution element

                    // First resolve all potential prefixes in the query.
                    const parsedSQ = this._parser.parse(substitutionQuery);
                    const algebraSQ = Algebra.translate(parsedSQ);

                    // Create a unique appendix for this replacement with a dash-less UUID.
                    const appendix = "_" + uuidv4().replace(/-/g, '');

                    // Subject and object in the user query might be NamedNodes instead of variables.
                    // So make sure to replace the ?_s and ?_o not just by name, but by their full representation.
                    let unique_algebraSQ = this._renameVariables(algebraSQ, appendix, currentPattern.subject, currentPattern.object);

                    // Now determine the substitution approach
                    // If the algebra is a projection without grouping or other features, drop the projection.
                    if (unique_algebraSQ.input) {
                        let next_input = unique_algebraSQ.input
                        // For 'extend' look at the nested input for the first one that is not an 'extend'
                        while (next_input.type == 'extend') {
                            next_input = next_input.input
                        }
                        if (["orderby", "group", "slice"].includes(next_input.type)) {
                            // The outer projection is required. Just keep it unmodified.
                        } else {
                            // The outer projection can be removed safely.
                            unique_algebraSQ = unique_algebraSQ.input;
                        }
                    }

                    const isolatedAlgebraSQ = unique_algebraSQ;

                    // Is anything remaining on the bgp side?
                    if (bgpElement.patterns.length>0) {
                        if (isolatedAlgebraSQ.type==='bgp') {
                            // Both BGPs can be joined.
                            return {
                                "type" : "bgp",
                                "patterns": [
                                    ...bgpElement.patterns , // All remaining patterns of the original BGP
                                    ...isolatedAlgebraSQ.patterns  // The patterns of the substitution query
                                ]
                            }
                        } else {
                            // Return a join of both the bgp and the isolatedAlgebraSQ
                            return {
                                "type" : "join",
                                "input": [
                                    { ...bgpElement }, // A copy of the element, since it still is the original.
                                    isolatedAlgebraSQ
                                ]
                            }
                        }
                    } else {
                        // Only return the new isoletedAlgebraSQ
                        return isolatedAlgebraSQ;
                    }
                } catch (error) {
                    // FIXME: Why does this not print the nested stack?
                    throw new Error(`Exception during substitution of predicate '${currentPattern.predicate.value}': 
                        Nested exception: ${error.stack}
                        ---
                        `
                    );
                }
            }

            // Handle the next element
            i++;
        }

        // If we come here, nothing changed, return undefined.
        return undefined;
    }

    /**
     * Method renames all variables in the provided algebra to unique names
     * by appending the provided appendix.
     * It changes the provided algebra in place and returns its value at the end.
     * @param {Algebra} algebra - The algebra of the query to be modified.
     * @param {string} appendix - The postfix to append to every variable.
     * @param {string} subject_element - The element that replaces the ?_s (var or named node)
     * @param {string} object_element - The element that replaces the ?_o (var or named node)
     * @returns {Algebra} the modified algebra.
     */
    _renameVariables(algebra, appendix, subject_element, object_element) {
        // The method cannot be directly called recursively, since it first needs to replace
        // all internal variables and at the end handle the _s and _o.
        // Performing all replacements at the same time may result in conflicts between
        // the outer 'non-appended' variables that result from the binding and the original inner ones.
        const renamerUnique = term => { 
            const varName = term.value;
            if (['_s','_o'].includes(varName)) {
                // For now, don't change these
            } else {
                // Sometimes. the variable is referenced multiple times in the algebra.
                // Avoid renaming the value twice.
                // e.g. when ?a ?p ?o; ?p2 ?o2.
                // The variable ?a then occurs twice, but is referencing the same JS object.
                if (!varName.endsWith(appendix)) {
                    term.value = varName + appendix;
                }
            }
            return term
        };
        this._renameVariables_internal(algebra, renamerUnique);

        const sIsVar = subject_element.type === 'variable';
        const oIsVar = object_element.type === 'variable';

        const renamerSpecial = term => {
            const varName = term.value;
            if ('_s' === varName) {
                Object.assign(term, subject_element);
            }
            else if ('_o' === varName) {
                Object.assign(term, object_element);
            }
            return term
        };
        this._renameVariables_internal(algebra, renamerSpecial);

        return algebra;
    }

    /**
     * Internal low level method for performing the actual renaming.
     * Not to be called externally
     * @param {Algebra} algebra - The algebra of the query to be modified.
     * @param {lambda} renamer - The renamer to be called.
     * @returns {void} 
     */
    _renameVariables_internal(algebra, renamer) {
        // Directly replace variables
        if (algebra.termType === 'Variable') {
            if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: Variable '${algebra.value}'`));
            renamer(algebra);
        } else switch(algebra.type) {
            case 'bgp':
                {
                    // Process patterns in a BGP
                    algebra.patterns = algebra.patterns.map(pattern => {
                        if (pattern.subject.termType === 'Variable') {
                            if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: BGP subject ${pattern.subject.value}`));
                            renamer(pattern.subject);
                        }
                        if (pattern.predicate.termType === 'Variable') {
                            if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: BGP predicate ${pattern.predicate.value}`));
                            renamer(pattern.predicate);
                        }
                        if (pattern.object.termType === 'Variable') {
                            if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: BGP object ${pattern.object.value}`));
                            renamer(pattern.object);
                        }
                        return pattern;
                    });
                }
                break;
            case 'project':
            case 'group':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: '${algebra.type}'`));
                    // Process other algebra types that contain variables
                    algebra.variables = algebra.variables.map(variable => ({
                        ...renamer(variable)
                    }));
                    // Only for group
                    if (algebra.aggregates) {
                        let i = 0;
                        while (i < algebra.aggregates.length) {
                            this._renameVariables_internal(algebra.aggregates[i], renamer);
                            i++;
                        }
                    }
                }
                break;
            case 'orderby':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: '${algebra.type}'`));
                    if (algebra.expressions) {
                        let i = 0;
                        while (i < algebra.expressions.length) {
                            this._renameVariables_internal(algebra.expressions[i], renamer);
                            i++;
                        }
                    }
                }
                break;
            case 'extend':
            case 'bind':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: '${algebra.type}'`));
                    // And the same, but different
                    algebra.variable = {
                        ...renamer(algebra.variable)
                    };
                    this._renameVariables_internal(algebra.expression, renamer);
                }
                break;
            case 'values':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: '${algebra.type}'`));
                    algebra.bindings = algebra.bindings.map(binding => {
                        const newBinding = {};
                        for (const key in binding) {
                            const tmpVar = {
                                type: 'variable',
                                value: key
                            }
                            const newKey = renamer(tmpVar).value
                            newBinding[newKey] = binding[key];
                        }
                        algebra.bindings = newBinding;
                    });
                }
                break;
            case 'path':
                {
                    if (algebra.subject.termType === 'Variable') {
                        if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: path subject ${algebra.subject.value}`));
                        renamer(algebra.subject);
                    }
                    // A path's predicate is not allowed to contain variables --> skip predicate
                    if (algebra.object.termType === 'Variable') {
                        if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: BGP object ${algebra.object.value}`));
                        renamer(algebra.object);
                    }
                }
                break;
            case 'filter':
                {
                    // Next to an input, filters have an expression.
                    // The expression can be nested, handle it as a seperate algebraic element
                    if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: 'filter'`));
                    this._renameVariables_internal(algebra.expression, renamer);
                }
                break;
            case 'expression':
                {
                    if (algebra.expressionType === 'operator') {
                        // An operator has arguments. Process all arguments
                        if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: operator '${algebra.operator}'`));
                        for (let arg of algebra.args) {
                            this._renameVariables_internal(arg, renamer);
                        }
                    } else if (algebra.expressionType === 'existence') {
                        this._renameVariables_internal(algebra.input, renamer);
                    } else if (algebra.expressionType === 'term') {
                        this._renameVariables_internal(algebra.term, renamer);
                    } else if (algebra.expressionType === 'aggregate') {
                        this._renameVariables_internal(algebra.expression, renamer);
                        this._renameVariables_internal(algebra.variable, renamer);
                    } else {
                        if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: Unsupported expression type '${algebra.expressionType}'`));
                    }
                }
                break;
            case 'link':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: handling path type 'link' - skip`));
                }
                break;
            case 'inv':
                {
                    if (this._doLog) console.log(chalk.blue.bold(`_renameVariables: handling path type 'inv'`));
                    this._renameVariables_internal(algebra.path, renamer);
                }
                break;
            case 'alt':
            case 'seq':
            case 'ZeroOrMorePath':
            case 'OneOrMorePath':
            case 'ZeroOrOnePath':
            default:
                // No action required (beyond possible algebra.input handled below)
        }

        // If the algebra also has an "input" member, then process all inputs.
        if (algebra.input) {
            if (Array.isArray(algebra.input)) {
                let i = 0;
                while (i < algebra.input.length) {
                    this._renameVariables_internal(algebra.input[i], renamer);
                    i++;
                }
            } else {
                // If there is only one element, the input becomes an object instead
                this._renameVariables_internal(algebra.input, renamer);
            }
        }
    }
}