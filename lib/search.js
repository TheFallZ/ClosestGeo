// Finds the countries whose span best matches the distance between two places.

const Shape = require('../public/js/shape.js');
const countries = require('../countries/countries.json');

const METERS_PER_MILE = 1609.344;
const MATCH_COUNT = 5;

// Spans a search can be matched against, by distance option
const SPAN_OPTIONS = {
    northSouth: [{ key: 'northSouth', label: 'North-South' }],
    westEast: [{ key: 'westEast', label: 'West-East' }],
    both: [{ key: 'northSouth', label: 'North-South' }, { key: 'westEast', label: 'West-East' }]
};

class UserError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function getFlagUrl(countryCode) {
    return `/flags/${countryCode.toLowerCase()}.png`;
}

// The closest countries by span, best first ("both" uses whichever span of each country is closer)
function closestMatches(distanceMiles, distanceOption) {
    const spanOptions = SPAN_OPTIONS[distanceOption] || SPAN_OPTIONS.both;
    return countries
        .map(country => {
            const span = spanOptions.reduce((best, option) =>
                Math.abs(country.distance[option.key] - distanceMiles) < Math.abs(country.distance[best.key] - distanceMiles) ? option : best
            );
            return {
                country: country.name,
                countryCode: country.countryCode,
                spanMiles: country.distance[span.key],
                distanceOptionUsed: span.label,
                flagUrl: getFlagUrl(country.countryCode),
                difference: Math.abs(country.distance[span.key] - distanceMiles)
            };
        })
        .sort((a, b) => a.difference - b.difference)
        .slice(0, MATCH_COUNT)
        .map(({ difference, ...match }) => match);
}

const formatCoordinates = ({ lat, lng }) =>
    `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}° ${lng >= 0 ? 'E' : 'W'}`;

// Reads one place from request input: either coordinates (from the map, "use my location" or an
// address suggestion) or an address to look up. Returns null if the address can't be found.
async function resolvePlace({ address, lat, lng }, geocode, ip) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const label = typeof address === 'string' ? address.trim() : '';

    if (lat != null && lat !== '' && lng != null && lng !== '' && Number.isFinite(latitude) && Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
        return { address: label || formatCoordinates({ lat: latitude, lng: longitude }), latitude, longitude };
    }
    if (!label) return undefined;

    const location = await geocode(label, ip);
    return location && { address: label, latitude: location.lat, longitude: location.lng };
}

// Runs a full search. `input` has address1/lat1/lng1, address2/lat2/lng2 and distanceOption.
async function search(input, geocode, ip) {
    const [place1, place2] = await Promise.all([
        resolvePlace({ address: input.address1, lat: input.lat1, lng: input.lng1 }, geocode, ip),
        resolvePlace({ address: input.address2, lat: input.lat2, lng: input.lng2 }, geocode, ip)
    ]);

    if (place1 === undefined || place2 === undefined) {
        throw new UserError(400, 'Please enter both addresses.');
    }

    // Tell the user which address couldn't be found
    const notFound = [[input.address1, place1], [input.address2, place2]]
        .filter(([, place]) => !place)
        .map(([address]) => `"${address}"`);
    if (notFound.length) {
        throw new UserError(404, `We couldn't find ${notFound.join(' or ')} on the map. Try adding a city, state or country.`);
    }

    const distanceMiles = Shape.distance(
        { lat: place1.latitude, lng: place1.longitude },
        { lat: place2.latitude, lng: place2.longitude }
    ) / METERS_PER_MILE;
    const matches = closestMatches(distanceMiles, input.distanceOption);
    const best = matches[0];

    return {
        country: best.country,
        distance: distanceMiles.toFixed(2) + ' miles',
        distanceMiles,
        countrySpanMiles: best.spanMiles,
        flagUrl: best.flagUrl,
        distanceOptionUsed: best.distanceOptionUsed,
        countryCode: best.countryCode,
        locations: [place1, place2],
        matches
    };
}

module.exports = { search, countries, UserError };
