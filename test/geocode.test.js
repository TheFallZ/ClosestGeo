const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGeocoder } = require('../lib/geocode');

function setUp(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closestgeo-geocode-'));
    const lookups = [];
    const geocoder = createGeocoder({
        cacheFile: path.join(dir, 'cache.json'),
        lookup: async (address) => {
            lookups.push(address);
            return address.includes('nowhere') ? null : { lat: 1, lng: 2 };
        },
        ...options
    });
    return { geocoder, lookups, dir };
}

test('repeat addresses come from the cache, ignoring case and spacing', async () => {
    const { geocoder, lookups } = setUp();
    assert.deepEqual(await geocoder.geocode('Chicago, IL', 'a'), { lat: 1, lng: 2 });
    assert.deepEqual(await geocoder.geocode('  chicago,   IL ', 'a'), { lat: 1, lng: 2 });
    assert.equal(lookups.length, 1);
});

test('addresses that cannot be found are cached too', async () => {
    const { geocoder, lookups } = setUp();
    assert.equal(await geocoder.geocode('nowhere', 'a'), null);
    assert.equal(await geocoder.geocode('nowhere', 'a'), null);
    assert.equal(lookups.length, 1);
});

test('limits new lookups per visitor, but not cached ones or other visitors', async () => {
    const { geocoder } = setUp({ maxLookups: 3 });
    for (let i = 0; i < 3; i++) await geocoder.geocode(`place ${i}`, 'visitor');
    await assert.rejects(geocoder.geocode('one more', 'visitor'), { status: 429, message: /Try again in 15 minutes/ });
    assert.deepEqual(await geocoder.geocode('place 0', 'visitor'), { lat: 1, lng: 2 }, 'cached address still works');
    assert.deepEqual(await geocoder.geocode('one more', 'someone else'), { lat: 1, lng: 2 }, 'other visitors are unaffected');
});

test('saves the cache to disk and loads it again', async () => {
    const { geocoder, dir } = setUp();
    await geocoder.geocode('Saved place', 'a');
    const cacheFile = path.join(dir, 'cache.json');
    await new Promise(resolve => {
        const check = setInterval(() => {
            if (fs.existsSync(cacheFile)) {
                clearInterval(check);
                resolve();
            }
        }, 50);
    });

    let calledAgain = false;
    const reloaded = createGeocoder({ cacheFile, lookup: async () => { calledAgain = true; return null; } });
    assert.deepEqual(await reloaded.geocode('saved place', 'a'), { lat: 1, lng: 2 });
    assert.equal(calledAgain, false);
});
