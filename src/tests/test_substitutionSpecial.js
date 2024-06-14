// Import required modules
import sparqljs from 'sparqljs';
import * as Algebra from 'sparqlalgebrajs';

const expected1 = `
SELECT ?s ?p ?o WHERE {
  ?a <https://mydom2#predB> ?b.
  FILTER EXISTS {
    ?var0 <https://mydom2#predN> ?q. #### THIS line is kept.
    { #### THIS block is removed
      SELECT (?_s AS ?q2) (?_o AS ?var0) WHERE {
        ?_s ?p ?_o.
      }
    }
  }
}`;

const parser = new sparqljs.Parser();
const parsed1 = parser.parse(expected1);
const algebra1 = Algebra.translate(parsed1);
const serial1 = Algebra.toSparql(algebra1);

// Serial 1 seems to be:
const observedSerial1 = `
 SELECT ?s ?p ?o WHERE {
  ?a <https://mydom2#predB> ?b.
  FILTER(EXISTS { ?var0 <https://mydom2#predN> ?q. })
}`;
