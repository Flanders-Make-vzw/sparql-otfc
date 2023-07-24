from otfc_python import OTFCPython
from datetime import datetime

if __name__ == "__main__":
    # Example to interact with node-otfc's bondREST.sparql test.
    # This predicate computes the age of the actor that played James Bond
    # in every Bond film. It does this based on a lookup on dbpedia.org.

    # The predicate is registered through a call to registerComputePredicate 
    # on the imported OTFCPython static class.
    OTFCPython.registerComputePredicate(
	# Argument 1: The IRI of the to be defined predicate.
        "http://flandersmake.be/otfc/bondActorAgeREST", 
	# Argument 2: The predicate query that fetches additional information
	# required for the computation of the predicate's object values.
        """
PREFIX dbo: <http://dbpedia.org/ontology/>
PREFIX dbr: <http://dbpedia.org/resource/>
PREFIX dbc: <http://dbpedia.org/resource/Category:>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?film ?dob
FROM <https://dbpedia.org/sparql>
WHERE {
	?film dbo:wikiPageWikiLink dbc:James_Bond_films.
    ?film dbo:starring ?actor.
    dbr:Portrayal_of_James_Bond_in_film dbo:portrayer ?actor.
    ?actor dbo:birthDate ?dob.
}
        """,
	# Argument 3: The name of the variable in the previous predicate query.
	# This will be matched with the subject of the predicate in the original query
	# asked by the user.
        "film",
	# Argument 4: The computation itself. Here it is a lambda since it is a short
	# calculation, but it might as well be a function.
	# Required contract:
	#   - accept a query response (a row in the result of the predicate query above)
	#   - return a dictionary with a key & value.
        lambda qr: {
            "key" : qr['film'], 
            "value" : datetime.utcnow() - datetime.strptime(qr['dob'], '%Y-%m-%d')
        }
    )

    # Just a trial (the query result contains x and y and the computation returns x+y)
    # Does not do anything useful and has the same structure as the example above.
    OTFCPython.registerComputePredicate(
        "http://www.flandersmake.be/ontology/trial/p1",
        "select ?subject, ?x, ?y where ...",
        "subject",
        lambda qr: {"key":qr['subject'], "value":qr['x'] + qr['y']}
    )
    # Just a trial (the query result contains x and y and the computation returns x*y)
    # Does not do anything useful and has the same structure as the example above.
    OTFCPython.registerComputePredicate(
        "http://www.flandersmake.be/ontology/trial/p2",
        "select ?a, ?x, ?y where ...",
        "a",
        lambda qr: {"key":qr['a'], "value":qr['x'] * qr['y']}
    )
	
    # Start the OTFC REST Server hosting the predicates described above.
    # Make sure to specify the desired interface IP and port number.
    # Be aware that you might run in a container and therefore localhost (127.x.y.z) may not be accessible from the outside.
    OTFCPython.startServing("0.0.0.0",8008)
