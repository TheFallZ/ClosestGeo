// Address lookups through Google's Geocoding API, with a cache saved to disk and a per-visitor
// limit on lookups, so repeat searches are free and nobody can run up the API bill.

const fs = require('fs');
const path = require('path');
const NodeGeocoder = require('node-geocoder');
const { createLimiter } = require('./rate-limit');

const DEFAULT_CACHE_FILE = path.join(__dirname, '..', 'data', 'geocode-cache.json');
const MAX_CACHE_ENTRIES = 5000;
// Lookups that miss the cache, per visitor per window. Each search needs up to two.
const MAX_LOOKUPS = 60;
const WINDOW_MS = 15 * 60 * 1000;

function loadCache(file) {
    try {
        return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
    } catch {
        return new Map();
    }
}

// Looks an address up with Google, returning { lat, lng } or null when it can't be found
function googleLookup(apiKey) {
    const geocoder = NodeGeocoder({ provider: 'google', apiKey });
    return async (address) => {
        const results = await geocoder.geocode(address);
        return results && results.length ? { lat: results[0].latitude, lng: results[0].longitude } : null;
    };
}

// `lookup` can replace the Google lookup (tests pass a fake one)
function createGeocoder({ apiKey, lookup = googleLookup(apiKey), cacheFile = DEFAULT_CACHE_FILE, maxLookups = MAX_LOOKUPS, windowMs = WINDOW_MS }) {
    const cache = loadCache(cacheFile);
    const limiter = createLimiter({
        max: maxLookups,
        windowMs,
        message: (seconds) => {
            const minutes = Math.ceil(seconds / 60);
            return `Too many new searches. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
        }
    });
    let saveTimer;

    const cacheKey = (address) => address.trim().toLowerCase().replace(/\s+/g, ' ');

    // Writes the cache shortly after the last change instead of on every lookup
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            fs.writeFile(cacheFile, JSON.stringify(Object.fromEntries(cache)), (error) => {
                if (error) console.error('Could not save geocode cache:', error.message);
            });
        }, 1000);
        saveTimer.unref();
    }

    // Returns { lat, lng } for an address, or null when it can't be found
    async function geocode(address, ip) {
        const key = cacheKey(address);
        if (cache.has(key)) return cache.get(key);

        limiter.use(ip);
        const location = await lookup(address);

        cache.set(key, location);
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        scheduleSave();
        return location;
    }

    return { geocode };
}

module.exports = { createGeocoder };
