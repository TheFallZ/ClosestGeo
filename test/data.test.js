// Checks the generated country data is complete and consistent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const countries = require('../countries/countries.json');
const boundaries = require('../countries/boundaries.json');
const facts = require('../countries/facts.json');

test('lists 196 countries with unique codes and no Israel', () => {
    assert.equal(countries.length, 196);
    const codes = countries.map(c => c.countryCode.toUpperCase());
    assert.equal(new Set(codes).size, codes.length, 'codes are unique');
    assert.ok(!codes.includes('IL'));
});

test('every country has spans, an outline, a flag and facts', () => {
    for (const { name, countryCode, distance } of countries) {
        const code = countryCode.toUpperCase();
        assert.ok(distance.westEast > 0 && distance.northSouth > 0, `${name} has spans`);
        assert.ok(boundaries[code], `${name} has an outline`);
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'flags', `${countryCode.toLowerCase()}.png`)), `${name} has a flag`);
        assert.ok(facts[code] && facts[code].capitals.length && facts[code].population && facts[code].areaKm2, `${name} has facts`);
    }
});
