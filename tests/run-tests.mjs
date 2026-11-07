#!/usr/bin/env node
// Offline tests for the UMN updater. No internet: the only server used is a local one on 127.0.0.1.
// Uses a frozen copy of a real UMN menu (tests/fixtures/seed-umn.json), never the live data file.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, cpSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nutrientIndex, parseNumber, campusDate, weekKeys, toAppUnit, unitOf, buildData, validate } from '../scripts/lib/convert.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const SEED = join(ROOT, 'tests/fixtures/seed-umn.json');
const seed = JSON.parse(readFileSync(SEED, 'utf8'));
const site = seed.sites[0];
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.log('  FAIL:', msg); } };
const fixtureName = path => path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_') + '.json';
const apiNutName = k => ({ 'Saturated Fat': 'Saturated Fat (g)', 'Trans Fat': 'Trans Fat (g)' }[k] || k);
const isHall = n => /dining hall/i.test(n);

function makeFixtures(dir, { skip = () => false, onlyStatus = false, mangle = null } = {}) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const put = (path, obj) => writeFileSync(join(dir, fixtureName(path)), JSON.stringify(obj));
  const D = seed.menuDate, SID = site.id;
  put(`/locations/status?site_id=${SID}&platform=0`, { locations: site.locations.map(l => ({ id: l.id, name: l.name, address: l.address, lat: l.lat, lon: l.lon, status: { message: l.status } })) });
  if (onlyStatus) return;
  put(`/locations/weekly_schedule?site_id=${SID}&date=${D}`, { the_locations: site.locations.map(l => ({ id: l.id, week: Object.entries(l.hours || {}).map(([date, v]) => ({ date, closed: v == null, hours: v == null ? [] : v.split(',').map(r => { const m = /(\d+):(\d+)-(\d+):(\d+)/.exec(r); return { start_hour: +m[1], start_minutes: +m[2], end_hour: +m[3], end_minutes: +m[4] }; }) })) })) });
  const apiItem = row => ({
    name: row[0], portion: row[1], desc: row[4], ingredients: row[5],
    nutrients: [{ name: 'Calories From Fat', value: '999' }, { name: 'Added Sugars (g)', value: '77' }]
      .concat(row[2].map((v, i) => ({ name: apiNutName(seed.nutrientKeys[i]), value: v == null ? '-' : String(v), value_numeric: v == null ? null : String(v) }))),
    filters: row[3].map(t => ({ name: seed.tags[t], type: 'label' }))
  });
  for (const l of site.locations) {
    if (skip(l)) continue;
    const periods = l.menu.map((m, i) => ({ id: `${l.id}-p${i}`, name: m.period }));
    const perMenu = (m, i) => ({ id: `${l.id}-p${i}`, name: m.period, categories: m.stations.map(s => ({ name: s.name, items: s.items.map(ix => apiItem(site.items[ix])) })) });
    let first = { periods, menu: l.menu.length ? { periods: perMenu(l.menu[0], 0) } : null };
    if (mangle) first = mangle(l, first) ?? first;
    put(`/location/${l.id}/periods?platform=0&date=${D}`, first);
    l.menu.forEach((m, i) => { if (i > 0) put(`/location/${l.id}/periods/${l.id}-p${i}?platform=0&date=${D}`, { menu: { periods: perMenu(m, i) } }); });
  }
}

const sig = (data, l) => JSON.stringify(l.menu.map(m => [m.period, m.stations.map(s => [s.name, s.items.map(ix => {
  const r = data.sites[0].items[ix]; const tags = r[3].map(t => data.tags[t]).sort();
  return [r[0], r[1], r[2], [...new Set(tags)], r[4], r[5]];
})])]));

const T = join(tmpdir(), 'pm-tests'); rmSync(T, { recursive: true, force: true }); mkdirSync(T, { recursive: true });
let caseNo = 0;
function freshOut() { const d = join(T, 'r' + (++caseNo)); mkdirSync(d, { recursive: true }); const out = join(d, 'umn.json'); copyFileSync(SEED, out); return { d, out }; }
async function updater(extraArgs, env = {}) {
  const { stdout } = await run('node', [join(ROOT, 'scripts/fetch-umn.mjs'), ...extraArgs, '--date', seed.menuDate], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', ...env } });
  return stdout;
}
const lastRun = d => JSON.parse(readFileSync(join(d, 'last-run.json'), 'utf8'));

console.log('Unit checks');
ok(nutrientIndex('Calories') === 0, 'Calories -> 0');
ok(nutrientIndex('Calories From Fat') === -1, 'Calories From Fat ignored');
ok(nutrientIndex('Added Sugars (g)') === -1, 'Added sugars ignored');
ok(nutrientIndex('Total Sugars (g)') === 4, 'Total Sugars -> sugar');
ok(nutrientIndex('Fat (g)') === 3 && nutrientIndex('Carbohydrates (g)') === 2 && nutrientIndex('Sat. Fat') === 7 && nutrientIndex('Fiber') === 5, 'name variants');
ok(nutrientIndex('Trans Fat (g)') === 8 && nutrientIndex('Saturated Fat (g)') === 7, 'fat kinds kept apart');
ok(toAppUnit(15, 2.5, unitOf({ name: 'Vitamin D (mcg)' })) === 100, 'Vitamin D mcg -> IU');
ok(toAppUnit(13, 333, unitOf({ name: 'Vitamin A (IU)' })) === 100, 'Vitamin A IU -> RE');
ok(toAppUnit(11, 10, unitOf({ name: 'Calcium', uom: '%DV' })) === 130, 'Calcium %DV -> mg');
ok(toAppUnit(6, 0.5, 'g') === 500, 'sodium g -> mg');
ok(toAppUnit(13, 5, 'oz') === null, 'unknown unit dropped, not guessed');
ok(parseNumber({ value: 'less than 1g', value_numeric: '1' }) === 0.5, '"less than" wins over value_numeric');
ok(parseNumber({ value: '12', value_numeric: '' }) === 12, 'empty value_numeric falls back to value');
ok(parseNumber({ value: '-' }) === null, '- -> null');
ok(parseNumber({ value_numeric: '12.5' }) === 12.5, 'value_numeric');
ok(parseNumber({ value: '1,200' }) === 1200, 'thousands separator');
ok(campusDate(new Date('2026-11-04T03:00:00Z')) === '2026-11-3', 'Chicago date before local midnight');
ok(campusDate(new Date('2026-11-04T07:00:00Z')) === '2026-11-4', 'Chicago date after local midnight');
ok(campusDate(new Date('2026-03-08T10:23:00Z')) === '2026-3-8', 'DST start day');
ok(weekKeys('2026-11-3')[0] === '2026-11-01' && weekKeys('2026-11-3')[6] === '2026-11-07', 'Sunday-Saturday week');
{
  const r = buildData({ prev: seed, menuDate: seed.menuDate, status: { locations: 'oops' }, schedule: { the_locations: {} }, menus: { [site.locations[0].id]: { not: 'an array' } } });
  ok(r.data.sites[0].locations.length === site.locations.length, 'weird shapes are skipped, places still carried over');
}

console.log('1. Round trip');
{
  const fx = join(T, 'fx1'), { d, out } = freshOut();
  makeFixtures(fx);
  const log = await updater(['--fixtures', fx, '--out', out]);
  console.log('  ' + log.trim().split('\n').join('\n  '));
  const got = JSON.parse(readFileSync(out, 'utf8'));
  ok(got.generated !== seed.generated, 'file was rewritten');
  const gl = Object.fromEntries(got.sites[0].locations.map(l => [l.id, l]));
  ok(got.sites[0].locations.length === site.locations.length, 'same number of places');
  let same = 0;
  for (const l of site.locations) {
    const g = gl[l.id];
    if (!g) { ok(false, `missing ${l.name}`); continue; }
    ok(g.name === l.name && g.address === l.address && g.lat === l.lat && g.status === l.status, `place details for ${l.name}`);
    ok(JSON.stringify(g.hours) === JSON.stringify(l.hours), `hours for ${l.name}`);
    if (sig(seed, l) === sig(got, g)) same++; else ok(false, `menu differs for ${l.name}`);
  }
  ok(same === site.locations.length, `menus identical for ${same}/${site.locations.length} places`);
  const r = lastRun(d);
  ok(r.published && r.problems.length === 0, 'run summary clean');
}

console.log('2. Bad day keeps the previous menu');
{
  const fx = join(T, 'fx2'), { d, out } = freshOut();
  makeFixtures(fx, { onlyStatus: true });
  const before = readFileSync(out, 'utf8');
  const log = await updater(['--fixtures', fx, '--out', out]);
  ok(/Not publishing/.test(log), 'refused to publish');
  ok(readFileSync(out, 'utf8') === before, 'previous menu untouched');
  ok(lastRun(d).published === false, 'summary says not published');
}

console.log('3. One hall fails, the rest still publish');
{
  const fx = join(T, 'fx3'), { d, out } = freshOut();
  const victim = site.locations.find(l => /Middlebrook/.test(l.name));
  makeFixtures(fx, { skip: l => l.id === victim.id });
  await updater(['--fixtures', fx, '--out', out]);
  const got = JSON.parse(readFileSync(out, 'utf8'));
  ok(got.sites[0].locations.find(l => l.id === victim.id).menu.length === 0, `${victim.name} shows no menu instead of a stale one`);
  ok(got.sites[0].locations.filter(l => l.menu.length).length === site.locations.filter(l => l.menu.length).length - 1, 'other places still have menus');
  ok(lastRun(d).problems.some(p => p.startsWith(victim.id)), 'failure logged');
}

console.log('4. Every dining hall fails: refuse, even though coffee shops still work');
{
  const fx = join(T, 'fx4'), { out } = freshOut();
  makeFixtures(fx, { skip: l => isHall(l.name) });
  const before = readFileSync(out, 'utf8');
  const log = await updater(['--fixtures', fx, '--out', out]);
  ok(/dining halls have menus/.test(log), 'reason names the dining halls');
  ok(readFileSync(out, 'utf8') === before, 'previous menu untouched');
}

console.log('5. Odd shapes in one hall do not sink the day');
{
  const fx = join(T, 'fx5'), { d, out } = freshOut();
  const victim = site.locations.find(l => /Comstock/.test(l.name));
  makeFixtures(fx, { mangle: (l, first) => {
    if (l.id !== victim.id) return first;
    first.menu.periods.categories = { weird: true };            // object instead of array
    return first;
  } });
  // also an item whose nutrients/filters are the wrong type, in another hall
  const other = site.locations.find(l => /Sanford/.test(l.name));
  const f = join(fx, fixtureName(`/location/${other.id}/periods?platform=0&date=${seed.menuDate}`));
  const j = JSON.parse(readFileSync(f, 'utf8')); j.menu.periods.categories[0].items[0].nutrients = { x: 1 }; j.menu.periods.categories[0].items[0].filters = 'Vegan';
  writeFileSync(f, JSON.stringify(j));
  await updater(['--fixtures', fx, '--out', out]);
  const got = JSON.parse(readFileSync(out, 'utf8'));
  ok(lastRun(d).published, 'still published');
  ok(got.sites[0].locations.filter(l => l.menu.length).length >= site.locations.filter(l => l.menu.length).length - 1, 'other places intact');
}

console.log('6. Unexpected crash: previous menu kept and the error recorded');
{
  const { d, out } = freshOut();
  writeFileSync(out, '{not json');
  const log = await updater(['--fixtures', join(T, 'fx1'), '--out', out]);
  ok(/Update failed, keeping the previous menu/.test(log), 'warning printed');
  ok(readFileSync(out, 'utf8') === '{not json', 'file untouched');
  ok(existsSync(join(d, 'last-run.json')) && lastRun(d).error, 'error recorded in last-run.json');
}

console.log('7. Being polite to the server (local test server)');
async function withServer(handler, fn) {
  let hits = 0;
  const srv = createServer((req, res) => { hits++; handler(req, res); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, () => hits); } finally { srv.close(); }
}
await withServer((req, res) => { res.writeHead(404); res.end('nope'); }, async (base, hits) => {
  const { out } = freshOut(); const before = readFileSync(out, 'utf8');
  await updater(['--out', out], { PM_BASE: base, PM_PAUSE_MS: '0' });
  ok(hits() === 3, `404s are never retried and the run stops after 3 in a row (${hits()} requests)`);
  ok(readFileSync(out, 'utf8') === before, 'menu kept');
});
await withServer((req, res) => { res.writeHead(429, { 'Retry-After': '0' }); res.end(); }, async (base, hits) => {
  const { out } = freshOut();
  await updater(['--out', out], { PM_BASE: base, PM_PAUSE_MS: '0' });
  ok(hits() <= 9, `rate-limited: at most 9 requests before stopping (${hits()})`);
});
await withServer((req, res) => {
  if (req.url.includes('/periods')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"periods":[]}'); }
  else { res.writeHead(500); res.end(); }
}, async (base, hits) => {
  const { d, out } = freshOut();
  await updater(['--out', out], { PM_BASE: base, PM_PAUSE_MS: '0' });
  ok(hits() <= 6 + site.locations.length, `5xx retried at most 3 times each (${hits()} requests)`);
  ok(lastRun(d).published === false, 'empty day not published');
});

console.log('8. Website build');
{
  const B = join(T, 'build'); rmSync(B, { recursive: true, force: true });
  mkdirSync(join(B, 'data'), { recursive: true }); cpSync(join(ROOT, 'app'), join(B, 'app'), { recursive: true }); cpSync(join(ROOT, 'scripts'), join(B, 'scripts'), { recursive: true });
  const evil = JSON.parse(readFileSync(SEED, 'utf8')); evil.sites[0].items[0][0] = 'Tricky <!-- </script><script>alert(1)</script> $& name';
  writeFileSync(join(B, 'data/umn.json'), JSON.stringify(evil));
  await run('node', [join(B, 'scripts/build.mjs')], { cwd: B });
  const html = readFileSync(join(B, 'site/index.html'), 'utf8');
  ok(/var LIVE=true;/.test(html), 'live flag on');
  ok(!html.includes('__UMN_JSON__'), 'data embedded');
  ok(/name="robots" content="noindex"/.test(html), 'kept out of search engines');
  const block = /<script id="umn-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  ok(block && JSON.parse(block[1]).sites[0].items[0][0] === evil.sites[0].items[0][0], 'tricky text survives and cannot break out of the data block');
  ok(existsSync(join(B, 'site/.nojekyll')), '.nojekyll present');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
