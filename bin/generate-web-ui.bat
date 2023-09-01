cd jQuery-Widget.js
npm install
node ./bin/generate.js -s ../settings.json -q ../queries
xcopy build/ ../web /s /i /y
copy ../w/* ../web/
