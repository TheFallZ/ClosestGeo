const test = require('node:test');
const assert = require('node:assert/strict');
const Shape = require('../public/js/shape.js');
const boundaries = require('../countries/boundaries.json');

const CHICAGO = { lat: 41.8781, lng: -87.6298 };
const HOUSTON = { lat: 29.7604, lng: -95.3698 };
const METERS_PER_MILE = 1609.344;
const miles = (meters) => meters / METERS_PER_MILE;

test('distance matches known city distances', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    assert.ok(Math.abs(Shape.distance(london, paris) / 1000 - 344) < 2, 'London to Paris is about 344 km');
    assert.ok(Math.abs(miles(Shape.distance(CHICAGO, HOUSTON)) - 942) < 2, 'Chicago to Houston is about 942 miles');
});

test('offset is the inverse of heading and distance', () => {
    const meters = Shape.distance(CHICAGO, HOUSTON);
    const bearing = Shape.heading(CHICAGO, HOUSTON);
    const end = Shape.offset(CHICAGO, meters, bearing);
    assert.ok(Shape.distance(end, HOUSTON) < 10, 'lands within 10 m of Houston');
});

test('interpolate finds the great-circle midpoint', () => {
    const middle = Shape.interpolate(CHICAGO, HOUSTON, 0.5);
    const toChicago = Shape.distance(middle, CHICAGO);
    const toHouston = Shape.distance(middle, HOUSTON);
    assert.ok(Math.abs(toChicago - toHouston) < 1);
});

test('normalizeAngle wraps into [-180, 180)', () => {
    assert.equal(Shape.normalizeAngle(190), -170);
    assert.equal(Shape.normalizeAngle(-190), 170);
    assert.equal(Shape.normalizeAngle(45), 45);
});

for (const [code, orientation] of [['NZ', 'North-South'], ['EG', 'West-East'], ['RU', 'West-East'], ['CL', 'North-South']]) {
    test(`placing ${code} keeps its true span and centers it between the points`, () => {
        const prepared = Shape.prepare(boundaries[code], orientation);
        const { center, rotation } = Shape.align(prepared, CHICAGO, HOUSTON);
        const placed = Shape.place(prepared, center, rotation);
        const [first, second] = placed.extremes;

        const placedSpan = Shape.distance(first, second);
        assert.ok(Math.abs(placedSpan - prepared.span) / prepared.span < 0.001, 'span is unchanged');

        // The gap between each extreme and its nearest point is the same at both ends
        const gap = (p) => Math.min(Shape.distance(p, CHICAGO), Shape.distance(p, HOUSTON));
        assert.ok(Math.abs(gap(first) - gap(second)) < 1000, 'gaps differ by under 1 km');
    });
}

test('clampCenter keeps shapes away from the poles', () => {
    const prepared = Shape.prepare(boundaries.RU, 'West-East');
    const nearPole = { lat: 85, lng: 0 };
    const clamped = Shape.clampCenter(prepared, nearPole, 0);
    const placed = Shape.place(prepared, clamped, 0);
    const northernmost = Math.max(...placed.rings.flat().map(p => p.lat));
    assert.ok(clamped.lat < nearPole.lat, 'center moved toward the equator');
    assert.ok(northernmost <= 81, `northernmost point ${northernmost.toFixed(1)} stays near 80°`);
});
