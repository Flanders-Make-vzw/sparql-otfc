cd jQuery-Widget.js
npm install
node ./bin/generate.js -s ../settings.json -q ../queries
xcopy build ..\web /e /h /c /i /s /y
copy ..\w\*.* ..\web
