const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const NodeGeocoder = require('node-geocoder');
const app = express();

app.use(bodyParser.json());
app.use(express.static('public'));

const GOOGLE_API_KEY = 'AIzaSyDDjQQUJWGM-QMnkXisfDyznRgrHxBCArI';

// Initialize geocoder
const geocoder = NodeGeocoder({
    provider: 'google',
    apiKey: GOOGLE_API_KEY
});

// Load countries list from JSON file
const countries = require('./countries/countries.json');

// Function to calculate the Haversine distance between two points in miles
function haversine(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of the Earth in miles
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Function to generate flag URL based on country abbreviation
function getFlagUrl(countryAbbreviation) {
    return `/flags/${countryAbbreviation.toLowerCase()}.png`;
}

// Function to generate outline URL based on country abbreviation
function getOutlineUrl(countryAbbreviation) {
    return `/outlines/${countryAbbreviation.toLowerCase()}/1024.png`;
}

// Serve the HTML file for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the results.html file for displaying results
app.get('/results.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

// Endpoint handler for finding the closest country
app.post('/find-country', async (req, res) => {
    const { address1, address2, distanceOption } = req.body;

    console.log('Received addresses:', address1, address2); // Log received addresses

    try {
        // Geocode addresses to get coordinates
        const [result1, result2] = await Promise.all([
            geocoder.geocode(address1),
            geocoder.geocode(address2)
        ]);

        // Log the geocoding results
        console.log('Geocoding result for address 1:', result1);
        console.log('Geocoding result for address 2:', result2);

        // Check if any of the geocoding results are empty arrays or undefined
        if (!result1 || !result1.length || !result2 || !result2.length) {
            res.status(404).json({ error: 'Address not found' });
            return;
        }

        // Extract latitude and longitude from geocoding results
        const { latitude: lat1, longitude: lon1 } = result1[0];
        const { latitude: lat2, longitude: lon2 } = result2[0];

        // Calculate the distance between the two locations
        const distance = haversine(lat1, lon1, lat2, lon2);
        console.log('Distance between locations:', distance); // Log distance

        // Initialize variables to find the closest country
        let closestCountry = countries[0];
        let smallestDifference = Infinity;
        let chosenOption = '';

        // Iterate through each country to find the closest one by distance
        for (const country of countries) {
            let difference;
            let option;

            if (distanceOption === 'northSouth') {
                // Calculate distance based on North-South distance
                difference = Math.abs(country.distance.northSouth - distance);
                option = 'North-South';
            } else if (distanceOption === 'westEast') {
                // Calculate distance based on West-East distance
                difference = Math.abs(country.distance.westEast - distance);
                option = 'West-East';
            } else {
                // Default to North-South if invalid option is provided
                difference = Math.abs(country.distance.northSouth - distance);
                option = 'North-South';
            }

            if (difference < smallestDifference) {
                closestCountry = country;
                smallestDifference = difference;
                chosenOption = option;
            }
        }

        console.log('Closest country by distance:', closestCountry); // Log closest country

        // Create the flag URL using the country abbreviation
        const flagUrl = getFlagUrl(closestCountry.countryCode);

        // Create the outline URL using the country abbreviation
        const outlineUrl = getOutlineUrl(closestCountry.countryCode);

        // Geocode the closest country's name to get its coordinates
        const countryGeo = await geocoder.geocode(closestCountry.name);

        if (!countryGeo.length) {
            res.status(404).json({ error: 'Country not found' });
            return;
        }

        const { latitude, longitude } = countryGeo[0];

        // Send the response with country data and distance option used
        res.json({
            country: closestCountry.name,
            distance: distance.toFixed(2) + " miles",
            flagUrl: flagUrl,
            distanceOptionUsed: chosenOption,
            coordinates: {
                latitude,
                longitude,
                outlineImageUrl: outlineUrl
            }
        });
    } catch (error) {
        console.error('Error during geocoding:', error); // Log the error
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});