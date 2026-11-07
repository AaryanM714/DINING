#!/usr/bin/env node
// Builds the website: app/app.src.html + data/umn.json -> site/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('app/app.src.html', 'utf8');
const raw = readFileSync('data/umn.json', 'utf8');
// Re-serialise (fails loudly on a corrupt file) and escape every "<" so the data can never close
// or comment out its <script> block. JSON.parse reads < back as "<".
const data = JSON.stringify(JSON.parse(raw)).replace(/</g, '\\u003c');

if (!src.includes('__UMN_JSON__')) throw new Error('app source is missing the __UMN_JSON__ placeholder');
if (!src.includes('/*LIVE*/false')) throw new Error('app source is missing the LIVE flag');

const body = src.replace('/*LIVE*/false', 'true').split('__UMN_JSON__').join(data);
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="description" content="Plate Math rates UMN dining hall food for your goals. Independent student project, not affiliated with UMN Dining.">
<title>Plate Math</title>
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync('site', { recursive: true });
writeFileSync('site/index.html', html);
writeFileSync('site/.nojekyll', '');
console.log(`Built site/index.html (${(html.length / 1024).toFixed(0)} KB)`);
