#!/usr/bin/env node
// Daily UMN menu update for Plate Math.
// Permission: M Food Co. (UMN Dining) said by email on Nov 6, 2026 that reading the published
// menus is fine as long as it doesn't affect the website. So this script is deliberately light:
// UMN only, once a day, one request at a time with a pause, retries only on 429/5xx (honouring
// Retry-After), and it stops the whole run after 3 failed requests in a row.
//
// Usage:
//   node scripts/fetch-umn.mjs                 live run (GitHub Actions)
//   node scripts/fetch-umn.mjs --fixtures DIR  offline run against saved responses (tests)
//   options: --date 2026-11-3  --out data/umn.json  --dry (don't write)
//   env (tests only): PM_BASE (API base URL), PM_PAUSE_MS (pause between requests)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildData, validate, campusDate, arr } from './lib/convert.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FIXTURES = opt('--fixtures', null);
const OUT = opt('--out', 'data/umn.json');
const DRY = args.includes('--dry');
const DATE = opt('--date', campusDate());
const BASE = process.env.PM_BASE || 'https://api.dineoncampus.com/v1';
const PAUSE_MS = FIXTURES ? 0 : +(process.env.PM_PAUSE_MS ?? 1500);
const MAX_LOCATIONS = 60;
const MAX_FAILS_IN_A_ROW = 3;
const UA = process.env.PM_USER_AGENT || 'PlateMath/1.0 (independent UMN student project; once-daily menu read)';
const RUN_FILE = join(dirname(OUT), 'last-run.json');
const GH = !!process.env.GITHUB_ACTIONS;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fixtureName = path => path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_') + '.json';
const warn = msg => console.log(GH ? `::warning::${msg}` : `WARNING: ${msg}`);

class StopRun extends Error {}
let requests = 0, failsInARow = 0;

async function get(path) {
  if (FIXTURES) {
    requests++;
    const f = join(FIXTURES, fixtureName(path));
    if (!existsSync(f)) throw new Error(`no fixture for ${path}`);
    return JSON.parse(readFileSync(f, 'utf8'));
  }
  let wait = PAUSE_MS;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(wait);
    requests++;
    let res;
    try {
      res = await fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      // network error or timeout: one more try after a longer pause
      wait = Math.max(PAUSE_MS, 1) * 4 * (attempt + 1);
      if (attempt === 2) return fail(`${path}: ${e.message}`);
      continue;
    }
    if (res.ok) {
      failsInARow = 0;
      try { return await res.json(); } catch { return fail(`${path}: response was not JSON`); }
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = +res.headers.get('retry-after');
      wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : Math.max(PAUSE_MS, 1) * 4 * (attempt + 1);
      if (attempt === 2) return fail(`${path}: HTTP ${res.status}`);
      continue;
    }
    return fail(`${path}: HTTP ${res.status}`); // 4xx other than 429: never retried
  }
}
function fail(msg) {
  failsInARow++;
  if (failsInARow >= MAX_FAILS_IN_A_ROW) throw new StopRun(`stopped after ${failsInARow} failed requests in a row (last: ${msg})`);
  throw new Error(msg);
}

function writeRun(summary) {
  if (DRY) return;
  try { writeFileSync(RUN_FILE, JSON.stringify(summary, null, 2) + '\n'); } catch {}
}

async function main() {
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const site = prev && prev.sites && prev.sites[0];
  const SITE_ID = process.env.PM_SITE_ID || (site && site.id) || '61d7515eb63f1e0e970debbe';
  console.log(`Plate Math UMN update for ${DATE} (site ${SITE_ID})${FIXTURES ? ' [fixtures]' : ''}`);

  const problems = [];
  let stopped = null;
  const safe = async (label, fn) => {
    if (stopped) return null;
    try { return await fn(); } catch (e) {
      if (e instanceof StopRun) { stopped = e.message; problems.push(e.message); }
      else problems.push(`${label}: ${e.message}`);
      return null;
    }
  };

  const status = await safe('status', () => get(`/locations/status?site_id=${SITE_ID}&platform=0`));
  const schedule = await safe('hours', () => get(`/locations/weekly_schedule?site_id=${SITE_ID}&date=${DATE}`));

  const ids = [...new Set([
    ...arr(status && status.locations).map(l => l && l.id),
    ...arr(site && site.locations).map(l => l && l.id)
  ])].filter(id => typeof id === 'string' && /^[a-z0-9]+$/i.test(id)).slice(0, MAX_LOCATIONS);

  const menus = {};
  let okPlaces = 0;
  for (const id of ids) {
    if (stopped) break;
    const out = await safe(id, async () => {
      const first = await get(`/location/${id}/periods?platform=0&date=${DATE}`);
      const list = arr(first && first.periods).filter(p => p && typeof p.id === 'string');
      const firstMenu = first && first.menu && first.menu.periods;
      const result = [];
      for (const p of list) {
        let per = firstMenu && firstMenu.id === p.id ? firstMenu : null;
        if (!per) {
          const r = await get(`/location/${id}/periods/${p.id}?platform=0&date=${DATE}`);
          per = r && r.menu && r.menu.periods;
        }
        if (per && typeof per === 'object') result.push({ id: p.id, name: p.name || per.name, categories: arr(per.categories) });
      }
      return result;
    });
    if (out) { menus[id] = out; if (out.length) okPlaces++; }
  }

  const { data, problems: convProblems } = buildData({ prev, menuDate: DATE, status, schedule, menus });
  problems.push(...convProblems);
  const v = stopped ? { ok: false, reasons: [stopped] } : validate(data, prev);
  const summary = {
    date: DATE, ranAt: new Date().toISOString(), requests, placesWithMenus: okPlaces,
    foods: data.sites[0].items.length, published: v.ok && !DRY, reasons: v.reasons, problems
  };

  if (!v.ok) {
    warn(`Not publishing: the new menu failed the safety checks (${v.reasons.join('; ')}). Keeping the previous menu.`);
  } else if (!DRY) {
    writeFileSync(OUT, JSON.stringify(data));
    console.log(`Saved ${OUT}: ${v.stats.places} places (${v.stats.halls} dining halls), ${v.stats.foods} foods, ${requests} requests.`);
  } else {
    console.log(`Dry run OK: ${v.stats.places} places (${v.stats.halls} dining halls), ${v.stats.foods} foods, ${requests} requests.`);
  }
  if (problems.length) warn(`${problems.length} problem(s): ${problems.slice(0, 10).join(' | ')}`);
  writeRun(summary);
}

main().catch(e => {
  // Anything unexpected: keep yesterday's menu, record why, and flag it in the log.
  warn(`Update failed, keeping the previous menu: ${e && e.message}`);
  writeRun({ date: DATE, ranAt: new Date().toISOString(), requests, published: false, error: String(e && e.stack || e) });
  process.exitCode = 0;
});
