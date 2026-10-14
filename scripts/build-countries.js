// Rebuilds the country data from Natural Earth's public-domain boundaries.
//
//   npm run build:countries
//
// Which countries are included (and their display names) comes from countries/countries.json.
// To add or remove a country, edit that list (name + 2-letter ISO code) and run this script.
// It rewrites:
//   - countries/boundaries.json: the outline drawn on the map for each country
//   - countries/countries.json:  each country's westEast / northSouth span in miles, measured
//                                between its extreme points (the same points the map lines up)
//   - countries/basemap.json:    low-detail outlines of every country, used to draw link preview images
//   - countries/facts.json:      capital, population and area of each country, from Wikidata

const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const DETAILED_SOURCE = 'ne_50m_admin_0_countries.geojson';
const BASEMAP_SOURCE = 'ne_110m_admin_0_countries.geojson';
const COUNTRIES_FILE = path.join(__dirname, '..', 'countries', 'countries.json');
const BOUNDARIES_FILE = path.join(__dirname, '..', 'countries', 'boundaries.json');
const BASEMAP_FILE = path.join(__dirname, '..', 'countries', 'basemap.json');
const FACTS_FILE = path.join(__dirname, '..', 'countries', 'facts.json');
const WIKIDATA_URL = 'https://query.wikidata.org/sparql';

// Islands within this distance of the main landmass (chained) count as part of the country,
// so nearby islands are kept but remote territories (Hawaii, Chatham Islands, overseas France) aren't
const MAX_GAP_KM = 300;
// Landmasses at least this fraction of the largest one always count (e.g. both halves of Malaysia)
const MAJOR_AREA_RATIO = 0.3;
const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.609344;

const rad = (degrees) => degrees * Math.PI / 180;

// Great-circle distance in km between two [lng, lat] points
function distanceKm([lng1, lat1], [lng2, lat2]) {
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
        Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Approximate ring area, only used to rank landmasses by size
function ringArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const k = Math.cos(rad(ring[i][1]));
        sum += ring[i][0] * k * ring[i + 1][1] - ring[i + 1][0] * k * ring[i][1];
    }
    return Math.abs(sum / 2);
}

function boundingBox(ring) {
    const lats = ring.map(p => p[1]);
    const lngs = ring.map(p => p[0]);
    return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) };
}

// Cheap lower bound on the gap in km between two bounding boxes, to skip far-apart pairs
function boundingBoxGapKm(a, b) {
    const latGap = Math.max(0, a.south - b.north, b.south - a.north) * 111;
    const lngGap = Math.max(0, a.west - b.east, b.west - a.east);
    const wrappedLngGap = Math.max(0, Math.min(lngGap, 360 - lngGap - (a.east - a.west) - (b.east - b.west)));
    const maxLat = Math.min(85, Math.max(Math.abs(a.south), Math.abs(a.north), Math.abs(b.south), Math.abs(b.north)));
    return Math.max(latGap, wrappedLngGap * 111 * Math.cos(rad(maxLat)));
}

function smallestGapKm(ring1, ring2) {
    let best = Infinity;
    for (const p of ring1) {
        for (const q of ring2) {
            best = Math.min(best, distanceKm(p, q));
            if (best < 1) return best;
        }
    }
    return best;
}

// Keeps the country's main landmasses plus nearby islands, dropping remote territories
function coreGeometry(geometry) {
    if (geometry.type === 'Polygon') return geometry;

    const polygons = geometry.coordinates
        .map(coordinates => ({ coordinates, box: boundingBox(coordinates[0]), area: ringArea(coordinates[0]) }))
        .sort((a, b) => b.area - a.area);

    const kept = polygons.filter(p => p.area >= polygons[0].area * MAJOR_AREA_RATIO);
    let remaining = polygons.filter(p => !kept.includes(p));
    let added = true;
    while (added) {
        added = false;
        for (const candidate of remaining) {
            const isNear = kept.some(k =>
                boundingBoxGapKm(k.box, candidate.box) <= MAX_GAP_KM &&
                smallestGapKm(k.coordinates[0], candidate.coordinates[0]) <= MAX_GAP_KM
            );
            if (isNear) {
                kept.push(candidate);
                added = true;
            }
        }
        remaining = remaining.filter(p => !kept.includes(p));
    }

    return kept.length === 1
        ? { type: 'Polygon', coordinates: kept[0].coordinates }
        : { type: 'MultiPolygon', coordinates: kept.map(p => p.coordinates) };
}

// Rounds coordinates to ~100 m to keep the file small
function roundCoordinates(c) {
    return Array.isArray(c[0]) ? c.map(roundCoordinates) : [+c[0].toFixed(3), +c[1].toFixed(3)];
}

// West-east and north-south spans in miles, measured between the extreme points
function spans(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const points = polygons.flatMap(polygon => polygon[0]);

    // Measure longitudes continuously for countries that cross the antimeridian
    const lngs = points.map(p => p[0]);
    const crosses = Math.max(...lngs) - Math.min(...lngs) > 180;
    const lng = (p) => (crosses && p[0] < 0 ? p[0] + 360 : p[0]);

    const north = points.reduce((a, p) => (p[1] > a[1] ? p : a));
    const south = points.reduce((a, p) => (p[1] < a[1] ? p : a));
    const west = points.reduce((a, p) => (lng(p) < lng(a) ? p : a));
    const east = points.reduce((a, p) => (lng(p) > lng(a) ? p : a));

    return {
        westEast: Math.round(distanceKm(west, east) / KM_PER_MILE),
        northSouth: Math.round(distanceKm(north, south) / KM_PER_MILE)
    };
}

// Downloads a Natural Earth file once and keeps it in the system temp folder
async function loadNaturalEarth(fileName) {
    const cacheFile = path.join(os.tmpdir(), `closestgeo-${fileName}`);
    if (!fs.existsSync(cacheFile)) {
        console.log(`Downloading ${SOURCE_BASE}${fileName}`);
        const response = await fetch(SOURCE_BASE + fileName);
        if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        fs.writeFileSync(cacheFile, await response.text());
    }
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
}

// Capital, population and area (km²) per country from Wikidata (public domain), using the
// values Wikidata marks as current. Countries with several capitals list them all.
async function buildFacts(countries) {
    const query = `
        SELECT ?code ?capitalLabel ?population ?area WHERE {
            ?country wdt:P297 ?code .
            OPTIONAL { ?country p:P1082 ?ps . ?ps ps:P1082 ?population . ?ps a wikibase:BestRank . }
            OPTIONAL { ?country p:P2046 ?as . ?as psv:P2046 ?av . ?av wikibase:quantityAmount ?area ;
                       wikibase:quantityUnit wd:Q712226 . ?as a wikibase:BestRank . }
            OPTIONAL { ?country p:P36 ?cs . ?cs ps:P36 ?capital . ?cs a wikibase:BestRank . }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }`;
    console.log('Downloading country facts from Wikidata');
    const response = await fetch(`${WIKIDATA_URL}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'ClosestGeo-build/1.0 (https://github.com/TheFallZ/ClosestGeo)' }
    });
    if (!response.ok) throw new Error(`Wikidata request failed: ${response.status} ${response.statusText}`);

    const byCode = {};
    for (const row of (await response.json()).results.bindings) {
        const entry = byCode[row.code.value] ||= { capitals: [], population: 0, areaKm2: 0 };
        const capital = row.capitalLabel && row.capitalLabel.value;
        if (capital && !entry.capitals.includes(capital)) entry.capitals.push(capital);
        if (row.population) entry.population = Math.max(entry.population, Number(row.population.value));
        if (row.area) entry.areaKm2 = Math.max(entry.areaKm2, Number(row.area.value));
    }

    const facts = {};
    for (const country of countries) {
        const entry = byCode[country.countryCode.toUpperCase()];
        if (!entry) continue;
        facts[country.countryCode.toUpperCase()] = {
            capitals: entry.capitals,
            population: entry.population || null,
            areaKm2: entry.areaKm2 ? +entry.areaKm2.toFixed(entry.areaKm2 < 10 ? 2 : 0) : null
        };
    }
    fs.writeFileSync(FACTS_FILE, JSON.stringify(facts, null, 1));
}

// Outer rings of every country, rounded to ~1 km: [[lng, lat], ...] per ring
async function buildBasemap() {
    const naturalEarth = await loadNaturalEarth(BASEMAP_SOURCE);
    const rings = [];
    for (const { geometry } of naturalEarth.features) {
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        for (const polygon of polygons) {
            rings.push(polygon[0].map(([lng, lat]) => [+lng.toFixed(2), +lat.toFixed(2)]));
        }
    }
    fs.writeFileSync(BASEMAP_FILE, JSON.stringify(rings));
}

async function main() {
    const naturalEarth = await loadNaturalEarth(DETAILED_SOURCE);
    const countries = JSON.parse(fs.readFileSync(COUNTRIES_FILE, 'utf8'));

    // Natural Earth leaves some ISO codes as -99 (e.g. France, Norway), so check the fallback fields too
    const geometryByCode = {};
    for (const feature of naturalEarth.features) {
        const p = feature.properties;
        for (const code of [p.ISO_A2, p.ISO_A2_EH, p.WB_A2]) {
            if (code && code !== '-99' && !geometryByCode[code]) geometryByCode[code] = feature.geometry;
        }
    }

    const boundaries = {};
    const missing = [];
    for (const country of countries) {
        const code = country.countryCode.toUpperCase();
        const geometry = geometryByCode[code];
        if (!geometry) {
            missing.push(`${code} (${country.name})`);
            continue;
        }
        const core = coreGeometry(geometry);
        boundaries[code] = { type: core.type, coordinates: roundCoordinates(core.coordinates) };
        country.distance = spans(boundaries[code]);
    }

    if (missing.length) {
        throw new Error(`No boundary found for: ${missing.join(', ')}. Check the country codes in countries.json.`);
    }

    fs.writeFileSync(BOUNDARIES_FILE, JSON.stringify(boundaries));
    const lines = countries.map(c =>
        `  { "name": ${JSON.stringify(c.name)}, "countryCode": "${c.countryCode}", "distance": { "westEast": ${c.distance.westEast}, "northSouth": ${c.distance.northSouth} } }`
    );
    fs.writeFileSync(COUNTRIES_FILE, '[\n' + lines.join(',\n') + '\n]\n');
    await buildBasemap();
    await buildFacts(countries);
    console.log(`Rebuilt ${countries.length} countries, their facts and the preview basemap.`);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
