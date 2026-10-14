const test = require('node:test');
const assert = require('node:assert/strict');
const { search, countries } = require('../lib/search');

const PLACES = {
    'chicago, il': { lat: 41.8781, lng: -87.6298 },
    'houston, tx': { lat: 29.7604, lng: -95.3698 }
};
const fakeGeocode = async (address) => PLACES[address.toLowerCase()] || null;

test('returns five matches, closest first', async () => {
    const result = await search({ address1: 'Chicago, IL', address2: 'Houston, TX', distanceOption: 'both' }, fakeGeocode, 'test');
    assert.equal(result.matches.length, 5);
    const differences = result.matches.map(m => Math.abs(m.spanMiles - result.distanceMiles));
    assert.deepEqual(differences, [...differences].sort((a, b) => a - b));
    assert.equal(result.country, result.matches[0].country);
    assert.equal(result.countrySpanMiles, result.matches[0].spanMiles);
});

test('a single distance option only uses that span', async () => {
    const result = await search({ address1: 'Chicago, IL', address2: 'Houston, TX', distanceOption: 'northSouth' }, fakeGeocode, 'test');
    for (const match of result.matches) {
        assert.equal(match.distanceOptionUsed, 'North-South');
        const country = countries.find(c => c.countryCode === match.countryCode);
        assert.equal(match.spanMiles, country.distance.northSouth);
    }
});

test('coordinates skip the address lookup', async () => {
    const neverCalled = async () => { throw new Error('should not look up coordinates'); };
    const result = await search({ address1: 'Map point', lat1: 48.86, lng1: 2.35, lat2: '55.76', lng2: '37.62' }, neverCalled, 'test');
    assert.equal(result.locations[0].address, 'Map point');
    assert.match(result.locations[1].address, /55\.76° N, 37\.62° E/);
});

test('names the address that could not be found', async () => {
    await assert.rejects(
        search({ address1: 'Nowhere at all', address2: 'Houston, TX' }, fakeGeocode, 'test'),
        { status: 404, message: /"Nowhere at all"/ }
    );
});

test('asks for both addresses when one is missing', async () => {
    await assert.rejects(search({ address1: 'Chicago, IL', address2: '' }, fakeGeocode, 'test'), { status: 400 });
    // null coordinates (from JSON) must not count as a place at 0°, 0°
    await assert.rejects(search({ address1: '', lat1: null, lng1: null, address2: 'Houston, TX' }, fakeGeocode, 'test'), { status: 400 });
});

test('out-of-range coordinates fall back to the address', async () => {
    const result = await search({ address1: 'Chicago, IL', lat1: 200, lng1: 0, address2: 'Houston, TX' }, fakeGeocode, 'test');
    assert.equal(result.locations[0].latitude, PLACES['chicago, il'].lat);
});
