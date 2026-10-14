const path = require('path');
const { createGeocoder } = require('./lib/geocode');
const { createStats } = require('./lib/stats');
const { createApp } = require('./lib/server');
const countries = require('./countries/countries.json');

// Load settings from .env (see .env.example) when the file exists
try {
    process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
    // No .env file; fall back to real environment variables
}

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
// Optional separate key for the browser map, so it can be restricted to your website
const GOOGLE_MAPS_BROWSER_KEY = process.env.GOOGLE_MAPS_BROWSER_KEY || GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error('Missing GOOGLE_API_KEY. Copy .env.example to .env and add your Google API key.');
    process.exit(1);
}

const app = createApp({
    geocode: createGeocoder({ apiKey: GOOGLE_API_KEY }).geocode,
    mapsApiKey: GOOGLE_MAPS_BROWSER_KEY,
    stats: createStats({ countryNames: Object.fromEntries(countries.map(c => [c.countryCode.toUpperCase(), c.name])) })
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
