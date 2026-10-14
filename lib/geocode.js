// Address lookups through Google's Geocoding API, with a cache saved to disk and a per-visitor
// limit on lookups, so repeat searches are free and nobody can run up the API bill.

const fs = require('fs');
const path = require('path');
const NodeGeocoder = require('node-geocoder');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'geocode-cache.json');
const MAX_CACHE_ENTRIES = 5000;
// Lookups that miss the cache, per visitor (IP address) per window. Each search needs up to two.
const MAX_LOOKUPS = 60;
const WINDOW_MS = 15 * 60 * 1000;

class RateLimitError extends Error {
    constructor(retryAfterSeconds) {
        const minutes = Math.ceil(retryAfterSeconds / 60);
        super(`Too many new searches. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`);
        this.status = 429;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

function loadCache() {
    try {
        return new Map(Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))));
    } catch {
        return new Map();
    }
}

function createGeocoder(apiKey) {
    const geocoder = NodeGeocoder({ provider: 'google', apiKey });
    const cache = loadCache();
    const usage = new Map(); // ip -> { count, resetAt }
    let saveTimer;

    const cacheKey = (address) => address.trim().toLowerCase().replace(/\s+/g, ' ');

    // Writes the cache shortly after the last change instead of on every lookup
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
            fs.writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)), (error) => {
                if (error) console.error('Could not save geocode cache:', error.message);
            });
        }, 1000);
    }

    function useLookup(ip) {
        const now = Date.now();
        let entry = usage.get(ip);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + WINDOW_MS };
            usage.set(ip, entry);
        }
        if (entry.count >= MAX_LOOKUPS) {
            throw new RateLimitError(Math.ceil((entry.resetAt - now) / 1000));
        }
        entry.count++;
    }

    // Forget visitors whose window has ended so the usage map doesn't grow forever
    setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of usage) {
            if (entry.resetAt <= now) usage.delete(ip);
        }
    }, WINDOW_MS).unref();

    // Returns { lat, lng } for an address, or null when Google can't find it
    async function geocode(address, ip) {
        const key = cacheKey(address);
        if (cache.has(key)) return cache.get(key);

        useLookup(ip);
        const results = await geocoder.geocode(address);
        const location = results && results.length
            ? { lat: results[0].latitude, lng: results[0].longitude }
            : null;

        cache.set(key, location);
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        scheduleSave();
        return location;
    }

    return { geocode };
}

module.exports = { createGeocoder, RateLimitError };
