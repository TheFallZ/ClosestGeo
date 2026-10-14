// Starts the app on a random port with a fake geocoder and checks each route.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/server');
const { createStats } = require('../lib/stats');

const PLACES = {
    'chicago, il': { lat: 41.8781, lng: -87.6298 },
    'houston, tx': { lat: 29.7604, lng: -95.3698 }
};

let server;
let base;
let stats;

test.before(async () => {
    stats = createStats({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'closestgeo-server-')), 'stats.json') });
    const app = createApp({
        geocode: async (address) => PLACES[address.toLowerCase()] || null,
        mapsApiKey: 'test-browser-key',
        stats
    });
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('serves the pages', async () => {
    for (const page of ['/', '/quiz.html', '/stats.html', '/results.html']) {
        const response = await fetch(base + page);
        assert.equal(response.status, 200, page);
        assert.match(response.headers.get('content-type'), /html/);
    }
});

test('/config sends the browser key', async () => {
    assert.deepEqual(await (await fetch(`${base}/config`)).json(), { mapsApiKey: 'test-browser-key' });
});

test('/countries includes facts', async () => {
    const list = await (await fetch(`${base}/countries`)).json();
    const egypt = list.find(c => c.countryCode === 'EG');
    assert.deepEqual(egypt.facts.capitals, ['Cairo']);
});

test('/country-shape returns outlines and 404s for unknown codes', async () => {
    const shape = await (await fetch(`${base}/country-shape/nz`)).json();
    assert.equal(shape.type, 'MultiPolygon');
    assert.equal((await fetch(`${base}/country-shape/zz`)).status, 404);
});

test('/find-country searches and records stats, except quiz rounds', async () => {
    const before = stats.summary().searches.total;
    const response = await post('/find-country', { address1: 'Chicago, IL', address2: 'Houston, TX', distanceOption: 'both' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.matches.length, 5);
    assert.equal(stats.summary().searches.total, before + 1);

    await post('/find-country', { address1: 'A', lat1: 41, lng1: -87, address2: 'B', lat2: 30, lng2: -95, source: 'quiz' });
    assert.equal(stats.summary().searches.total, before + 1, 'quiz round not counted');
});

test('/find-country explains bad input', async () => {
    const notFound = await post('/find-country', { address1: 'Nowhere', address2: 'Houston, TX' });
    assert.equal(notFound.status, 404);
    assert.match((await notFound.json()).error, /"Nowhere"/);
    assert.equal((await post('/find-country', { address1: 'Chicago, IL' })).status, 400);
});

test('/results.html adds link preview tags only for searches', async () => {
    const shared = await (await fetch(`${base}/results.html?address1=Chicago%2C%20IL&address2=Houston%2C%20TX`)).text();
    assert.match(shared, /<meta property="og:title" content="Chicago, IL → Houston, TX \| ClosestGeo">/);
    assert.match(shared, /og:image" content="http:\/\/127\.0\.0\.1:\d+\/preview\.png\?/);
    const plain = await (await fetch(`${base}/results.html`)).text();
    assert.doesNotMatch(plain, /og:title/);
});

test('/preview.png draws a PNG', async () => {
    const response = await fetch(`${base}/preview.png?address1=Chicago%2C%20IL&address2=Houston%2C%20TX`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG signature');
});

test('/stats/quiz accepts valid results and /stats.json reports them', async () => {
    assert.equal((await post('/stats/quiz', { type: 'answer', difficulty: 'easy', correct: true })).status, 204);
    assert.equal((await post('/stats/quiz', { type: 'daily', score: 3 })).status, 204);
    assert.equal((await post('/stats/quiz', { type: 'answer', difficulty: 'nope', correct: true })).status, 400);

    const summary = await (await fetch(`${base}/stats.json`)).json();
    assert.equal(summary.quiz.practice.find(d => d.difficulty === 'easy').correct, 1);
    assert.equal(summary.quiz.daily.played, 1);
});
