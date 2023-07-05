/* Copyright (C) 2022 Flanders Make - CodesignS */

import express from 'express';

const app = express();
app.use(express.static('web'));
app.listen(3001, () => {
	console.log('Web UI running on http://localhost:3001');
});