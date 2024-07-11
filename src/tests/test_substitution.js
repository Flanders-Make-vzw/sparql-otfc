// Import required modules
import sparqljs from 'sparqljs';
import * as Algebra from 'sparqlalgebrajs';
import SubstitutionHandler from '../substitutionHandler.js';
import chalk from 'chalk';
import  _  from 'lodash';

const predicatesToSubstitute = [];
predicatesToSubstitute["https://mydom2#predReplace"] = `
    PREFIX : <https://mydom2#>
    select ?_s ?_o where {
        ?_s :predA ?a2.
        optional {
            ?a2 :predB ?c2.
        }
        {
            select ?a2 ?_o {
                ?a2 a :myClass;
                    :predD ?_o.

                ?a3 !(:predF|:predG)|:predH+|:predJ?|:predK*|(:predL|^:predM) ?_o.
            }
        }
    }
`;
predicatesToSubstitute["https://mydom2#predReplace2"] = `
  PREFIX : <https://mydom2#>
  select (?a2 as ?_s) (?a3 as ?_o) (max(?a4) as ?b) where {
    select * where {
          ?a3 :predA ?a2.
          OPTIONAL { ?s :predB ?a3. }
          FILTER(
            (
              (
                !(BOUND(?a3))
              ) 
              ||
              (
                EXISTS { 
                  ?s :predC* ?a4.
                }
              )
            ) 
            &&
            ( ?a5 <= ?a6 )
          )
      } order by (?a2 ) 
  } group by ?a2 ?a3
`;
predicatesToSubstitute["https://mydom2#predReplace3"] = `
  PREFIX : <https://mydom2#>
  select ?_s ?_o where {
    ?_s :testA ?_o.
  } 
`;

const handler = new SubstitutionHandler();

function testQ(q, expectedQ, msg) {
    const resultQ = handler.handle(q, predicatesToSubstitute)

    // Do not check for literal equivalence, but for algebraic equivalence.
    const parser = new sparqljs.Parser();

    // Parse to algebra and remove all replacement uuids
    const expectedEQ = expectedQ.replace(/_[a-z0-9]{32,32}/g, '_replaced');
    const parsedEQ = parser.parse(expectedEQ);
    const algebraEQ = Algebra.translate(parsedEQ);
    
    const observedRQ = resultQ.replace(/_[a-z0-9]{32,32}/g, '_replaced');
    const parsedRQ = parser.parse(observedRQ);
    const algebraRQ= Algebra.translate(parsedRQ);

    if (_.isEqual(algebraEQ,algebraRQ)) {
        console.log(chalk.blue.bold(`Test '${msg}': Ok`));
    } else {
        console.log(chalk.red.bold(`Test '${msg}': Not equal`));
        console.log(chalk.red.bold(`Test '${msg}': Expected \n${expectedEQ}\n`));
        console.log(chalk.red.bold(`Test '${msg}': Observed \n${observedRQ}\n`));
    }
}

function testQShouldFail(q, msg) {
    try {
        const resultQ = handler.handle(q, predicatesToSubstitute)

        console.log(chalk.red.bold(`Test '${msg}': Does not produce expected exception.`));
        try {
            const parser = new sparqljs.Parser();

            const observedRQ = resultQ.replace(/_[a-z0-9]{32,32}/g, '_replaced');
            const parsedRQ = parser.parse(observedRQ);
            const algebraRQ= Algebra.translate(parsedRQ);

            console.log(chalk.red.bold(`Test '${msg}': Observed \n${observedRQ}`));
        } catch (error) {
            console.log(chalk.red.bold(`Test '${msg}': Observed result is not parseable... ${error}`));
        }
    } catch (error) {
        console.log(chalk.blue.bold(`Test '${msg}': Ok. Received expected exception: ${error}`));
    }
}


// Example SPARQL query
const uq1 = `
PREFIX : <https://mydom2#>
  SELECT ?s ?p ?o
  WHERE {
	{
		select ?a {
			?a ?p ?o.
		}
	}
	?a :predB ?b;
	   :predC ?c;
	   :predReplace/:predD* ?d. # Paths allowed
	?d :predE ?e.
	optional {
		?a :predF ?f.
	}
	{
		select ?f {
			?f ?p2 ?o2.
		}
	}
    ?a3 !(:predF|:predG)|:predH+|:predJ?|:predK*|(:predL|^:predM) ?b3.

    FILTER ( # Filters supported
      (?a > 3) 
      || EXISTS {
        ?q ^(:predReplace/:predN) ?q2. # Inverted path allowed, even with seq.
      }
    )
  }
`;

const expected1 = `
SELECT ?s ?p ?o WHERE {
  { SELECT ?a WHERE { ?a ?p ?o. } }
  ?a <https://mydom2#predB> ?b;
    <https://mydom2#predC> ?c;
    <https://mydom2#predA> ?a2_replaced.
  OPTIONAL { ?a2_replaced <https://mydom2#predB> ?c2_replaced. }
  {
    SELECT ?a2_replaced ?var0 WHERE {
      ?a2_replaced <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://mydom2#myClass>;
        <https://mydom2#predD> ?var0.
      ?a3_replaced (!(<https://mydom2#predF>|<https://mydom2#predG>)|(<https://mydom2#predH>+)|(<https://mydom2#predJ>?)|(<https://mydom2#predK>*)|<https://mydom2#predL>|^<https://mydom2#predM>) ?var0.
    }
  }
  ?var0 (<https://mydom2#predD>*) ?d.
  ?d <https://mydom2#predE> ?e.
  OPTIONAL { ?a <https://mydom2#predF> ?f. }
  { SELECT ?f WHERE { ?f ?p2 ?o2. } }
  ?a3 (!(<https://mydom2#predF>|<https://mydom2#predG>)|(<https://mydom2#predH>+)|(<https://mydom2#predJ>?)|(<https://mydom2#predK>*)|<https://mydom2#predL>|^<https://mydom2#predM>) ?b3.
  FILTER((?a > 3 ) || (EXISTS {
    ?var0 <https://mydom2#predN> ?q.
    ?q2 <https://mydom2#predA> ?a2_replaced.
    OPTIONAL { ?a2_replaced <https://mydom2#predB> ?c2_replaced. }
    {
      SELECT ?a2_replaced ?var0 WHERE {
        ?a2_replaced <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://mydom2#myClass>;
          <https://mydom2#predD> ?var0.
        ?a3_replaced (!(<https://mydom2#predF>|<https://mydom2#predG>)|(<https://mydom2#predH>+)|(<https://mydom2#predJ>?)|(<https://mydom2#predK>*)|<https://mydom2#predL>|^<https://mydom2#predM>) ?var0.
      }
    }
  }))
}`;

const uq2 = `
PREFIX : <https://mydom2#>
  SELECT ?s ?p ?o
  WHERE {
    ?s :predA*/(^:predB|:predC)/:predReplace/(:predD/:predE)* ?o.
  }
`;

const expected2 = `
SELECT ?s ?p ?o WHERE {
  ?s (<https://mydom2#predA>*) ?var0.
  ?var0 (^<https://mydom2#predB>|<https://mydom2#predC>) ?var1.
  ?var1 <https://mydom2#predA> ?a2_replaced.
  OPTIONAL { ?a2_replaced <https://mydom2#predB> ?c2_replaced. }
  {
    SELECT ?a2_replaced ?var2 WHERE {
      ?a2_replaced <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://mydom2#myClass>;
        <https://mydom2#predD> ?var2.
      ?a3_replaced (!(<https://mydom2#predF>|<https://mydom2#predG>)|(<https://mydom2#predH>+)|(<https://mydom2#predJ>?)|(<https://mydom2#predK>*)|<https://mydom2#predL>|^<https://mydom2#predM>) ?var2.
    }
  }
  ?var2 ((<https://mydom2#predD>/<https://mydom2#predE>)*) ?o.
}
`;

const uq3 = `
PREFIX : <https://mydom2#>
  SELECT ?s ?p ?o
  WHERE {
    ?s ?p ?o.
    ?s :predReplace2 ?o2.
  }
`;

const expected3 = `
SELECT ?s ?p ?o WHERE {
  ?s ?p ?o.
  {
    SELECT (?a2_replaced AS ?s) (?a3_replaced AS ?o2) (MAX(?a4_replaced) AS ?b_replaced) WHERE {
      SELECT ?a2_replaced ?a3_replaced ?s_replaced WHERE {
        ?a3_replaced <https://mydom2#predA> ?a2_replaced.
        OPTIONAL { ?s_replaced <https://mydom2#predB> ?a3_replaced. }
        FILTER(((!(BOUND(?a3_replaced))) || (EXISTS { ?s_replaced (<https://mydom2#predC>*) ?a4_replaced. })) && (?a5_replaced <= ?a6_replaced))
      }
      ORDER BY (?a2_replaced)
    }
    GROUP BY ?a2_replaced ?a3_replaced
  }
}
`;

const uq4 = `
PREFIX : <https://mydom2#>
  SELECT ?s ?p ?o
  WHERE {
    ?s ?p ?o;
       :predReplace3 ?o2.
  }
`;


const expected4 = `
SELECT ?s ?p ?o WHERE {
  ?s ?p ?o;
    <https://mydom2#testA> ?o2.
}
`;

const uq5 = `
PREFIX : <https://mydom2#>
  SELECT ?s ?p ?o
  WHERE {
    ?s ?p ?o;
       :predReplace3 4.
  }
`;

const expected5 = `
SELECT ?s ?p ?o WHERE {
  ?s ?p ?o;
    <https://mydom2#testA> 4.
}
`;

const uq6 = `
PREFIX : <https://mydom2#>
  SELECT ?s ?p ?o
  WHERE {
   <http://abc> ?p ?o;
       :predReplace3 ?o2.
  }
`;

const expected6 = `
SELECT ?s ?p ?o WHERE {
  <http://abc> ?p ?o;
    <https://mydom2#testA> ?o2.
}
`;

testQ(uq1, expected1, "ok1");
testQ(uq2, expected2, "ok2");
testQ(uq3, expected3, "ok3");
testQ(uq4, expected4, "ok4 - simple 1/1 replacement of predicate");
testQ(uq5, expected5, "ok5 - object is named node");
testQ(uq6, expected6, "ok6 - subject is named node");

testQShouldFail(`
    PREFIX : <https://mydom2#>
    SELECT ?s ?p ?o
    WHERE {
        ?s (:predB|^:predReplace) ?o.
    }
    `,"alt");

testQShouldFail(`
    PREFIX : <https://mydom2#>
    SELECT ?s ?p ?o
    WHERE {
        ?s (^:predB|:predReplace) ?o.
    }
    `, "inv");

testQShouldFail(`
    PREFIX : <https://mydom2#>
        SELECT ?s ?p ?o
        WHERE {
        ?s :predReplace* ?o.
        }
    `, "ZeroOrMore");
    
testQShouldFail(`
    PREFIX : <https://mydom2#>
        SELECT ?s ?p ?o
        WHERE {
        ?s :predReplace? ?o.
        }
    `, "ZeroOrOne");

  testQShouldFail(`
    PREFIX : <https://mydom2#>
        SELECT ?s ?p ?o
        WHERE {
        ?s :predReplace+ ?o.
        }
    `, "OneOrMore");
    
  testQShouldFail(`
    PREFIX : <https://mydom2#>
        SELECT ?s ?p ?o
        WHERE {
        ?s :predA|(:predB/:predReplace) ?o.
        }
    `, "Sequence");