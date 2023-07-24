import uvicorn
import traceback
from fastapi import Depends, FastAPI, HTTPException
from typing import List, Union, TypedDict
from pydantic import BaseModel
from collections.abc import Callable

app = FastAPI()

class OTFCPredicate(BaseModel):
    predicateIRI: str
    predicateQuery: str
    predicateQuerySubject: str
    predicateKind: str

class OTFCComputationRequest(BaseModel):
    predicateIRI: str
    computationInput: List[dict]

class OTFCComputationResult(BaseModel):
    result: List[dict]

class OTFCPython:
    class CallbackRegistration(TypedDict):
        predicate: str
        callback: Callable[[dict],dict]

    knownPredicates=[]
    knownCallbacks = CallbackRegistration()

    def __init__(self) -> None:
        pass

    def registerComputePredicate(predicateIRI: str, predicateQuery: str, predicateQuerySubject: str, callback: Callable[[dict],dict]):
        """Use this method to contribute new predicates.

        Args:
            predicateIRI (str): The full (non-abbreviated) predicate IRI.
            predicateQuery (str): The SPARQL query that retrieves any additional data required for the computation. 
            predicateQuerySubject (str): The name of the subject variable in the predicate query. 
            callback (function): Function that takes a single line of OTFCPredicateResults and provides a single result, both as a dict.
        """        
        newPredicate = OTFCPredicate(predicateKind="compute",
            predicateIRI=predicateIRI,
            predicateQuery=predicateQuery,
            predicateQuerySubject=predicateQuerySubject)
        OTFCPython.knownPredicates.append(newPredicate)
        OTFCPython.knownCallbacks[predicateIRI] = callback

    def startServing(host, port):
        uvicorn.run(app, host=host, port=port)

@app.get("/predicates")
async def getPredicates(otfc: OTFCPython = Depends(OTFCPython)) -> List[OTFCPredicate]:
    """Mandatory REST method
    
       It should return the list of all defined predicates with their metadata
       as described in the OTFCPredicate structure above.
    """
    return otfc.knownPredicates

@app.post("/compute")
async def compute(computationRequest: OTFCComputationRequest, otfc: OTFCPython = Depends(OTFCPython)) -> OTFCComputationResult:
    """Mandatory REST method
    
       The incoming call provides an OTFCComputationRequest with the structure as described aboven.
       It contains the IRI of the to be processed predicate and a list of computation inputs.
       Based on this information, the predicate's registered callback is called for each individual row of computation inputs.
       The callback's invocation results are collected in the OTFCComputationResult object and sent back to the caller.
    """
    predicate = computationRequest.predicateIRI
    callback = OTFCPython.knownCallbacks[predicate]
    if not callback:
        raise HTTPException(status_code=404, detail=f"No OTFCPredicate registered for IRI {predicate}.")

    # Would be better as a stream...
    computationResult: List[dict] = []
    for input in computationRequest.computationInput:
        try:
            result = callback(input)
            computationResult.append(result)
        except:
            print(f"Exception while computing {predicate} for input {input}.")
            traceback.print_exc()
            # Should also send error-result to client or just ignore missing results?
    return OTFCComputationResult(result=computationResult)
