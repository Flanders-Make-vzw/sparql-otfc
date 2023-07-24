#!/bin/bash

# Process the parameters
SETTINGS=../settings.json
QUERIES=../queries
while [ $# -gt 0 ]; do
	if [[ $1 == "-s" ]]; then
		SETTINGS=$2
		shift
	elif [[ $1 == "-q" ]]; then
		QUERIES=$2
		shift
	else
		echo "$0: unknown option: $1"
		exit 1
	fi
	shift
done

if [ ! -f jQuery-Widget.js/package.json ]
then
	echo "jQueryWidget.js is not available. Submodule initialised and updated?"
	exit 1

fi

cd jQuery-Widget.js
# Make sure jQuery has all required dependencies
npm install

# Then generate the web UI 
./bin/generate.js -s $SETTINGS -q $QUERIES
rsync -a --delete build/ ../web
cp ../w/* ../web/

# comunica-web-client-generator -s settings.json -q queries