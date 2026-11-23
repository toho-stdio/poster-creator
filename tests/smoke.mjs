import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../worker/index.js';

class FakeDb {
  admins = [];
  images = [];
  backgrounds = [];
  batch() { return Promise.resolve({ success: true }); }
  prepare(sql) {
    let params = [];
    const statement = {
      bind(...values) { params = values; return statement; },
      first: async () => {
        if (sql.includes('FROM admins WHERE user_id')) return this.admins.find(x => x.user_id === params[0]) || null;
        if (sql.includes('FROM admins LIMIT 1')) return this.admins[0] || null;
        if (sql.includes('FROM images WHERE id')) return this.images.find(x => x.id === params[0]) || null;
        if (sql.includes('FROM backgrounds WHERE slot')) return this.backgrounds.find(x => x.slot === params[0]) || null;
        return null;
      },
      all: async () => ({ results: sql.includes('FROM backgrounds') ? this.backgrounds.map(({ slot, original_name, mime_type, size_bytes, updated_at }) => ({ slot, original_name, mime_type, size_bytes, updated_at })) : this.images.map(({ id, original_name, mime_type, size_bytes, lunar_year, lunar_month, is_leap, lunar_day, created_at }) => ({ id, original_name, mime_type, size_bytes, lunar_year, lunar_month, is_leap, lunar_day, created_at })) }),
      run: async () => {
        if (sql.startsWith('INSERT OR IGNORE INTO admins')) {
          if (!this.admins.length) this.admins.push({ user_id: params[0], created_at: params[1] });
        } else if (sql.startsWith('INSERT INTO images')) {
          const [id, storage_key, original_name, mime_type, size_bytes, lunar_year, lunar_month, is_leap, lunar_day, created_at, updated_at] = params;
          this.images.push({ id, storage_key, original_name, mime_type, size_bytes, lunar_year, lunar_month, is_leap, lunar_day, created_at, updated_at });
        } else if (sql.startsWith('INSERT INTO backgrounds')) {
          const [slot, storage_key, original_name, mime_type, size_bytes, updated_at, updated_by] = params;
          const existing = this.backgrounds.find(x => x.slot === slot);
          if (existing) Object.assign(existing, { storage_key, original_name, mime_type, size_bytes, updated_at, updated_by });
          else this.backgrounds.push({ slot, storage_key, original_name, mime_type, size_bytes, updated_at, updated_by });
        } else if (sql.startsWith('UPDATE images')) {
          const [storage_key, original_name, mime_type, size_bytes, lunar_year, lunar_month, is_leap, lunar_day, updated_at, id] = params;
          Object.assign(this.images.find(x => x.id === id), { storage_key, original_name, mime_type, size_bytes, lunar_year, lunar_month, is_leap, lunar_day, updated_at });
        } else if (sql.startsWith('DELETE FROM images')) {
          this.images = this.images.filter(x => x.id !== params[0]);
        }
        return { success: true };
      }
    };
    return statement;
  }
}

const db = new FakeDb();
const objects = new Map();
const env = {
  DB: db,
  BUCKET: {
    async put(key, value) { objects.set(key, new Uint8Array(value)); },
    async get(key) { const bytes = objects.get(key); return bytes ? { body: bytes } : null; },
    async delete(key) { objects.delete(key); }
  }
};
const req = (path, options = {}, user = 'owner-1') => new Request(`https://test.local${path}`, {
  ...options,
  headers: { ...(options.headers || {}), ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test` } : {}) }
});
const fetch = async (path, options, user) => worker.fetch(req(path, options, user), env);

const home = await fetch('/');
assert.equal(home.status, 200);
const html = await home.text();
assert.match(html, /1080 × 1350/);
assert.match(html, /Phóng sinh trong suốt Huế/);
assert.match(html, /id="posterCanvas" width="1080" height="1350"/);
assert.match(html, /id="themePicker"/);
assert.match(html, /Zen Minimal/);
assert.match(html, /Heritage Gold/);
assert.match(html, /Modern Editorial/);
assert.doesNotMatch(html, /locationReviewed|review-check/, 'no address confirmation checkbox is shown');
assert.match(html, /id="posterLocationDetail"/);
assert.match(html, /fonts.googleapis.com\/css/);
const clientScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(clientScript, 'poster client script is present');
assert.doesNotThrow(() => new vm.Script(clientScript), 'poster client script parses');
const themeStart = clientScript.indexOf('const POSTER_THEMES=');
const themeEnd = clientScript.indexOf('\nfunction renderThemePicker', themeStart);
const themes = vm.runInNewContext(`(()=>{${clientScript.slice(themeStart, themeEnd)};return POSTER_THEMES})()`);
assert.deepEqual(Object.keys(themes), ['zen', 'heritage', 'editorial'], 'the requested three poster design themes exist');
assert.deepEqual(Object.values(themes).map(theme => theme.name), ['Zen Minimal', 'Heritage Gold', 'Modern Editorial']);
const layoutSnapshot = Object.values(themes).map(theme => JSON.stringify(theme.layout));
assert.equal(new Set(layoutSnapshot).size, 3, 'each theme has a genuinely different group layout');
for (const [id, theme] of Object.entries(themes)) {
  for (const zoneName of ['kicker', 'title', 'subtitle', 'location', 'footer']) {
    const zone = theme.layout[zoneName];
    assert.ok(zone && Number.isFinite(zone.x) && Number.isFinite(zone.y) && Number.isFinite(zone.width) && zone.align, `${id}.${zoneName} is defined as a layout zone`);
  }
  assert.ok(['split', 'stacked'].includes(theme.layout.event.mode), `${id} groups date and time`);
  for (const styleName of ['kicker', 'title', 'subtitle', 'label', 'lunar', 'gregorian', 'time', 'period', 'location', 'detail', 'footer']) {
    const style = theme.type[styleName];
    assert.ok(style && style.family && Number.isFinite(style.size) && Number.isFinite(style.weight) && Number.isFinite(style.spacing) && style.color, `${id}.${styleName} has typography and color tokens`);
  }
  assert.equal(theme.effects.strokeWidth, 0, `${id} has no text stroke`);
  assert.equal(theme.effects.shadowBlur, 0, `${id} has no heavy text shadow`);
  assert.equal(theme.colors.ink, '#284D45');
}
const posterRenderStart = clientScript.indexOf('async function renderPoster(');
const posterRenderEnd = clientScript.indexOf('\nfunction downloadPoster', posterRenderStart);
const posterRenderer = clientScript.slice(posterRenderStart, posterRenderEnd);
assert.doesNotMatch(posterRenderer, /createLinearGradient|fillRect\(0,520|strokeText/, 'poster background has no dimming overlay or heavy outlined text');
assert.match(clientScript, /aria-pressed=/, 'theme selection exposes its active state accessibly');
const locationValidationStart = clientScript.indexOf('function validPosterLocation(');
const locationValidationEnd = clientScript.indexOf('\nasync function renderPoster', locationValidationStart);
const validPosterLocation = vm.runInNewContext(`(${clientScript.slice(locationValidationStart, locationValidationEnd).replace(/\n.*/, '')})`);
assert.equal(validPosterLocation('Hdhcc'), false, 'short accidental locations are rejected before export');
assert.equal(validPosterLocation('Bến thuyền số 5 Lê Lợi'), true, 'complete location names can be used');
assert.match(clientScript, /function ensurePosterFonts\(/, 'poster fonts are loaded before canvas rendering');
assert.match(clientScript, /await ensurePosterFonts\(\)/, 'canvas waits for the requested font families');
assert.match(clientScript, /family:'"Be Vietnam Pro", sans-serif'/, 'Be Vietnam Pro family name is quoted for canvas');
assert.match(clientScript, /family:'"Noto Serif", Georgia, serif'/, 'Noto Serif family name is quoted for canvas');
assert.match(clientScript, /normalize\('NFC'\)/, 'text fitting handles normalized Vietnamese accents');
const weekdayStart = clientScript.indexOf('function eventGregorianDate(');
const weekdayEnd = clientScript.indexOf('\nasync function renderPoster', weekdayStart);
const weekdayFormatter = vm.runInNewContext(`(${clientScript.slice(weekdayStart, weekdayEnd).split('\n')[0]})`);
assert.equal(weekdayFormatter(new Date(2024, 0, 1, 12)), 'Thứ Hai · 01.01.2024', 'poster shows Vietnamese weekday and Gregorian date');
const eventRowStart = clientScript.indexOf('function eventRow(');
const eventRowEnd = clientScript.indexOf('\nfunction renderUpcoming', eventRowStart);
const eventContext = { eventName: day => day === 1 ? 'Mồng một' : 'Ngày rằm' };
const renderEvent = vm.runInNewContext(`(${clientScript.slice(eventRowStart, eventRowEnd)})`, eventContext);
const mondayRow = renderEvent({ date: new Date(2024, 0, 1, 12), lunar: { year: 2024, month: 1, day: 1, leap: 0 }, iso: '2024-01-01' }, true);
assert.match(mondayRow, /Thứ 2/, 'Monday is displayed as Thứ 2');
assert.match(mondayRow, /Sắp tới gần nhất/, 'nearest upcoming event is highlighted');
assert.match(mondayRow, /Tạo poster/, 'upcoming event launches the poster workflow');
const defaultTimeStart = clientScript.indexOf('function defaultTimeFor(');
const defaultTimeEnd = clientScript.indexOf('\nfunction openPosterEditor', defaultTimeStart);
const defaultTime = vm.runInNewContext(`(${clientScript.slice(defaultTimeStart, defaultTimeEnd)})`);
assert.equal(defaultTime(new Date(2026, 0, 15, 12)).time, '11:30', 'winter uses the approved default time');
assert.equal(defaultTime(new Date(2026, 6, 15, 12)).time, '17:30', 'summer uses the approved default time');

for (const [date, expected] of [
  ['2024-02-10', { day: 1, month: 1, year: 2024, leap: 0 }],
  ['2023-03-22', { day: 1, month: 2, year: 2023, leap: 1 }],
  ['2023-04-20', { day: 1, month: 3, year: 2023, leap: 0 }],
  ['2024-09-17', { day: 15, month: 8, year: 2024, leap: 0 }]
]) {
  const [year, month, day] = date.split('-');
  const response = await fetch(`/api/calendar?year=${year}&month=${month}`);
  assert.equal(response.status, 200, `calendar ${date}`);
  const calendar = await response.json();
  const actual = calendar.days.find(x => x.solar.day === Number(day)).lunar;
  assert.deepEqual(actual, expected, `lunar date for ${date}`);
}

const unauth = await fetch('/api/images', { method: 'POST' }, null);
assert.equal(unauth.status, 401, 'anonymous write is rejected');
let session = await (await fetch('/api/session')).json();
assert.equal(session.can_claim, true);
assert.equal((await fetch('/api/admin/claim', { method: 'POST' })).status, 200);
session = await (await fetch('/api/session')).json();
assert.equal(session.admin, true);

const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const deniedBackgroundForm = new FormData();
deniedBackgroundForm.append('slot', '1');
deniedBackgroundForm.append('file', new Blob([png], { type: 'image/png' }), 'background.png');
assert.equal((await fetch('/api/backgrounds', { method: 'POST', body: deniedBackgroundForm }, 'viewer-2')).status, 403, 'background upload is admin-only');
const backgroundForm = new FormData();
backgroundForm.append('slot', '1');
backgroundForm.append('file', new Blob([png], { type: 'image/png' }), 'background-mau-1.png');
assert.equal((await fetch('/api/backgrounds', { method: 'POST', body: backgroundForm })).status, 201, 'background upload succeeds');
const savedBackgrounds = await (await fetch('/api/backgrounds')).json();
assert.equal(savedBackgrounds.length, 1, 'background metadata persists');
assert.equal(savedBackgrounds[0].slot, 1);
const backgroundBytes = await (await fetch('/api/backgrounds/1')).arrayBuffer();
assert.deepEqual(new Uint8Array(backgroundBytes), png, 'background image bytes persist in object storage');

const form = new FormData();
form.append('lunar_year', '2023'); form.append('lunar_month', '2'); form.append('is_leap', '1'); form.append('lunar_day', '15');
form.append('files', new Blob([png], { type: 'image/png' }), 'ảnh-rằm.png');
form.append('files', new Blob([png], { type: 'image/png' }), 'ảnh-rằm-2.png');
let response = await fetch('/api/images', { method: 'POST', body: form });
assert.equal(response.status, 201, 'multi-file upload succeeds');
const uploaded = await response.json();
assert.equal(uploaded.count, 2, 'multiple upload persists two files');

// A fresh request simulates a refresh: metadata is read back from D1 and objects remain in R2.
let images = await (await fetch('/api/images?year=2023&month=2&leap=1&day=15')).json();
assert.equal(images.length, 2);
assert.equal(objects.size, 3);
response = await fetch(`/api/files/${uploaded.images[0].id}?download=1`);
assert.equal(response.status, 200, await response.clone().text());
assert.match(response.headers.get('content-disposition'), /attachment/);
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png, 'download returns original bytes');

const replaceForm = new FormData();
replaceForm.append('lunar_year', '2023'); replaceForm.append('lunar_month', '2'); replaceForm.append('is_leap', '1'); replaceForm.append('lunar_day', '15');
replaceForm.append('files', new Blob([Uint8Array.from([...png, 1])], { type: 'image/png' }), 'replacement.png');
response = await fetch(`/api/images/${uploaded.images[0].id}/replace`, { method: 'POST', body: replaceForm });
assert.equal(response.status, 201, 'replacement succeeds');
images = await (await fetch('/api/images')).json();
assert.equal(images[0].original_name, 'replacement.png');

assert.equal((await fetch(`/api/images/${uploaded.images[1].id}`, { method: 'DELETE' }, 'viewer-2')).status, 403, 'non-admin delete is rejected');
assert.equal((await fetch(`/api/images/${uploaded.images[1].id}`, { method: 'DELETE' })).status, 200, 'admin delete succeeds');
assert.equal((await (await fetch('/api/images')).json()).length, 1);

console.log('Smoke checks passed: lunar dates + leap month, 3 distinct poster themes, text fitting/effects, weekday, address length guard, and seasonal time defaults, admin background upload, R2 original bytes, and legacy endpoints.');
