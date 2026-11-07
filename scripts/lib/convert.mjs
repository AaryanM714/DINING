// Turns Dine On Campus API responses into the menu format the Hall Pass app reads.
// Pure functions only (no network), so they can be tested with saved responses.
// Every input is treated as untrusted: wrong shapes are skipped, never allowed to crash the day.

export const NUTRIENT_KEYS = [
  'Calories', 'Protein (g)', 'Total Carbohydrates (g)', 'Total Fat (g)', 'Sugar (g)',
  'Dietary Fiber (g)', 'Sodium (mg)', 'Saturated Fat', 'Trans Fat', 'Cholesterol (mg)',
  'Potassium (mg)', 'Calcium (mg)', 'Iron (mg)', 'Vitamin A (RE)', 'Vitamin C (mg)', 'Vitamin D (IU)'
];
export const ITEM_FORMAT = ['name', 'portion', 'nutrients[nutrientKeys]', 'tagIdx[]', 'description', 'ingredients'];

export const arr = x => (Array.isArray(x) ? x : []);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const str = x => (x == null ? '' : typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '');

// Matchers in the same order as NUTRIENT_KEYS. Names are lowercased with units removed first.
const MATCHERS = [
  /^(total )?calories$|^energy$/,
  /^protein/,
  /^(total )?carbohydrates?$|^total carbohydrates?|^carbs?$/,
  /^(total )?fat$/,
  /^(total )?sugars?$/,
  /^(dietary )?fib(er|re)/,
  /^sodium/,
  /^sat(urated|\.)?\s*fat/,
  /^trans\.?\s*fat/,
  /^cholesterol/,
  /^potassium/,
  /^calcium/,
  /^iron/,
  /^vitamin a\b|^vit\.? a\b/,
  /^vitamin c\b|^vit\.? c\b/,
  /^vitamin d\b|^vit\.? d\b/
];

export function nutrientIndex(name) {
  const n = str(name).toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < MATCHERS.length; i++) if (MATCHERS[i].test(n)) return i;
  return -1;
}

// Unit from the uom field or from "(…)" in the name.
export function unitOf(nut) {
  const u = str(nut && nut.uom) || ((/\(([^)]*)\)/.exec(str(nut && nut.name)) || [])[1] || '');
  return u.toLowerCase().replace(/\s+/g, '');
}

// Daily values (FDA) for converting "%DV" to the app's units.
const DV = { 10: 4700, 11: 1300, 12: 18, 13: 900, 14: 90, 15: 800 }; // K mg, Ca mg, Fe mg, Vit A mcg≈RE, Vit C mg, Vit D IU (20 mcg)

// Convert a value to the unit the app expects for that nutrient. Returns null when the unit can't be converted.
export function toAppUnit(i, v, unit) {
  if (v == null) return null;
  if (!unit) return v;
  if (/%|dv/.test(unit)) return DV[i] ? +(v / 100 * DV[i]).toFixed(2) : null;
  switch (i) {
    case 13: // Vitamin A, app uses RE (≈ mcg RAE)
      if (/^(re|rae|mcg|µg|ug|mcgrae)$/.test(unit)) return v;
      if (unit === 'iu') return +(v / 3.33).toFixed(1);
      return null;
    case 15: // Vitamin D, app uses IU
      if (unit === 'iu') return v;
      if (/^(mcg|µg|ug)$/.test(unit)) return v * 40;
      return null;
    case 0:
      return /^(kcal|cal|calories)?$/.test(unit) ? v : null;
    case 6: case 9: case 10: case 11: case 12: case 14: // mg nutrients
      if (unit === 'mg') return v;
      if (unit === 'g') return v * 1000;
      if (/^(mcg|µg|ug)$/.test(unit)) return v / 1000;
      return null;
    default: // gram nutrients
      if (unit === 'g') return v;
      if (unit === 'mg') return v / 1000;
      return null;
  }
}

export function parseNumber(nut) {
  if (nut == null || typeof nut !== 'object') return null;
  const s = str(nut.value).trim().toLowerCase();
  if (/^(<|less than)/.test(s)) {
    const m = /\d+(\.\d+)?/.exec(s);
    return m ? parseFloat(m[0]) / 2 : null; // "less than 1g" -> 0.5
  }
  const vn = nut.value_numeric;
  if (vn !== null && vn !== undefined && vn !== '') {
    const n = typeof vn === 'number' ? vn : parseFloat(String(vn).replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  if (!s || s === '-' || s === 'n/a' || s === 'na') return null;
  const m = /-?\d+(\.\d+)?/.exec(s.replace(/,/g, ''));
  return m ? parseFloat(m[0]) : null;
}

// Calendar date in a time zone, in the API's unpadded style: 2026-11-3
export function campusDate(d = new Date(), tz = 'America/Chicago') {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const g = t => +p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function padDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str(s));
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}
function addDays(padded, n) {
  const [y, m, d] = padded.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekdayOf(padded) {
  const [y, m, d] = padded.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
// Sunday-to-Saturday week containing the date, as padded keys.
export function weekKeys(menuDate) {
  const p = padDate(menuDate);
  const start = addDays(p, -weekdayOf(p));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const hm = (h, m) => `${+h}:${String(+m || 0).padStart(2, '0')}`;

// Weekly schedule -> { 'YYYY-MM-DD': '7:00-20:00' | '7:00-10:00,11:00-14:00' | null }
export function parseWeek(loc) {
  const out = {};
  for (const day of arr(obj(loc).week)) {
    const d = obj(day);
    const key = padDate(d.date);
    if (!key) continue;
    const ranges = arr(d.hours)
      .map(obj)
      .filter(h => Number.isFinite(+h.start_hour) && Number.isFinite(+h.end_hour) && h.start_hour !== null && h.end_hour !== null)
      .map(h => `${hm(h.start_hour, h.start_minutes)}-${hm(h.end_hour, h.end_minutes)}`);
    out[key] = d.closed || !ranges.length ? null : ranges.join(',');
  }
  return out;
}

// Fallback: reuse last week's hours for the same weekday.
export function carryHours(prevHours, menuDate) {
  if (!prevHours || typeof prevHours !== 'object') return null;
  const byWeekday = {};
  for (const [k, v] of Object.entries(prevHours)) { const p = padDate(k); if (p) byWeekday[weekdayOf(p)] = v; }
  const out = {};
  for (const k of weekKeys(menuDate)) out[k] = byWeekday[weekdayOf(k)] ?? null;
  return out;
}

function addressText(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  const o = obj(a);
  return [o.street, o.city, o.state, o.zip_code || o.zip].map(str).filter(Boolean).join(', ');
}
const num = x => (x === null || x === undefined || x === '' ? null : Number.isFinite(+x) ? +x : null);

const isHall = name => /dining hall/i.test(name);

/**
 * Build the app's data file.
 *   prev: previous data file (for carry-over of addresses, coordinates, hours and tag order)
 *   menuDate: '2026-11-3'
 *   status, schedule: raw API responses (or null)
 *   menus: { [locationId]: [ { id, name, categories:[{ name, items:[...] }] }, ... ] }
 * Returns { data, problems }.
 */
export function buildData({ prev, menuDate, status, schedule, menus, now = new Date() }) {
  const problems = [];
  const prevSite = obj(arr(obj(prev).sites)[0]);
  const prevLocs = Object.fromEntries(arr(prevSite.locations).map(obj).filter(l => l.id).map(l => [l.id, l]));
  const statusLocs = Object.fromEntries(arr(obj(status).locations).map(obj).filter(l => l.id).map(l => [l.id, l]));
  const sched = obj(schedule);
  const schedLocs = Object.fromEntries(arr(sched.the_locations || sched.locations).map(obj).filter(l => l.id).map(l => [l.id, l]));
  menus = obj(menus);

  const tags = arr(obj(prev).tags).map(str);
  const tagIdx = new Map(tags.map((t, i) => [t, i]));
  const tagOf = name => {
    if (!tagIdx.has(name)) { tagIdx.set(name, tags.length); tags.push(name); }
    return tagIdx.get(name);
  };

  const items = [];
  const itemIdx = new Map();
  const itemOf = raw => {
    const nut = new Array(NUTRIENT_KEYS.length).fill(null);
    for (const n of arr(raw.nutrients)) {
      if (!n || typeof n !== 'object') continue;
      const k = nutrientIndex(n.name);
      if (k >= 0 && nut[k] == null) nut[k] = toAppUnit(k, parseNumber(n), unitOf(n));
    }
    const t = [...new Set(arr(raw.filters).map(obj).map(f => str(f.name)).filter(Boolean).map(tagOf))];
    const row = [str(raw.name), str(raw.portion), nut, t, str(raw.desc || raw.description), str(raw.ingredients)];
    const key = JSON.stringify(row);
    if (!itemIdx.has(key)) { itemIdx.set(key, items.length); items.push(row); }
    return itemIdx.get(key);
  };

  const ids = [...new Set([...Object.keys(menus), ...Object.keys(statusLocs), ...Object.keys(prevLocs)])].filter(Boolean);
  const locations = [];
  for (const id of ids) {
    try {
      const p = obj(prevLocs[id]);
      const st = obj(statusLocs[id]);
      const name = str(st.name) || str(p.name);
      if (!name) continue;
      const menu = [];
      for (const per of arr(menus[id]).map(obj)) {
        const stations = [];
        for (const cat of arr(per.categories).map(obj)) {
          const list = arr(cat.items).filter(it => it && typeof it === 'object' && str(it.name)).map(itemOf);
          if (list.length) stations.push({ name: str(cat.name) || 'Menu', items: list });
        }
        if (stations.length) menu.push({ period: str(per.name) || 'Menu', stations });
      }
      const weekParsed = schedLocs[id] ? parseWeek(schedLocs[id]) : null;
      const hours = weekParsed && Object.keys(weekParsed).length ? weekParsed : carryHours(p.hours, menuDate);
      const sts = st.status;
      const statusText = typeof sts === 'string' ? sts : str(obj(sts).message) || str(obj(sts).label);
      locations.push({
        id, name,
        address: addressText(st.address) || str(p.address),
        lat: num(st.lat ?? st.latitude) ?? num(p.lat),
        lon: num(st.lon ?? st.longitude) ?? num(p.lon),
        status: statusText,
        hours: hours || null,
        pay: arr(p.pay),
        menu
      });
    } catch (e) {
      problems.push(`${id}: could not read (${e.message})`);
    }
  }

  return {
    problems,
    data: {
      generated: now.toISOString(),
      menuDate,
      nutrientKeys: NUTRIENT_KEYS,
      itemFormat: ITEM_FORMAT,
      tags,
      sites: [{ id: prevSite.id, name: str(prevSite.name) || 'University of Minnesota', slug: str(prevSite.slug) || 'UMN', locations, items }]
    }
  };
}

// Safety checks: never publish a broken or near-empty menu.
// Compares with yesterday's file when there is one, so losing every dining hall can't slip through.
export function validate(data, prev, { minItems = 100, minLocations = 3, minShareOfPrev = 0.4 } = {}) {
  const reasons = [];
  const s = data && data.sites && data.sites[0];
  if (!s) return { ok: false, reasons: ['no site'] };
  const withMenus = s.locations.filter(l => l.menu.length);
  const hallsNow = withMenus.filter(l => isHall(l.name)).length;
  const ps = prev && prev.sites && prev.sites[0];
  const prevWith = ps ? arr(ps.locations).filter(l => arr(l.menu).length) : [];
  const hallsPrev = prevWith.filter(l => isHall(l.name)).length;
  const prevFoods = ps ? arr(ps.items).length : 0;

  if (withMenus.length < minLocations) reasons.push(`only ${withMenus.length} places have menus (need ${minLocations})`);
  if (s.items.length < minItems) reasons.push(`only ${s.items.length} foods (need ${minItems})`);
  const needHalls = Math.min(3, hallsPrev);
  if (hallsNow < needHalls) reasons.push(`only ${hallsNow} dining halls have menus (yesterday ${hallsPrev})`);
  if (prevFoods && s.items.length < prevFoods * minShareOfPrev) reasons.push(`only ${s.items.length} foods vs ${prevFoods} yesterday`);
  const bad = s.items.filter(r => !Array.isArray(r[2]) || r[2].length !== NUTRIENT_KEYS.length).length;
  if (bad) reasons.push(`${bad} foods have malformed nutrients`);
  const noCal = s.items.filter(r => r[2][0] == null).length;
  if (s.items.length && noCal / s.items.length > 0.6) reasons.push(`${Math.round(noCal / s.items.length * 100)}% of foods have no calories`);
  for (const l of s.locations) for (const m of l.menu) for (const st of m.stations) for (const i of st.items)
    if (!(i >= 0 && i < s.items.length)) { reasons.push(`bad item reference in ${l.name}`); return { ok: false, reasons }; }
  return { ok: reasons.length === 0, reasons, stats: { places: withMenus.length, halls: hallsNow, foods: s.items.length } };
}
