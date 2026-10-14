# ClosestGeo

Welcome to ClosestGeo, a web application designed to help users explore distances between two addresses and discover which country spans that geographical expanse. This project is a fun and educational tool for anyone curious about geography, ideal for students, travelers, and geography enthusiasts.

## Table of Contents
- [Project Overview](#project-overview)
- [Features](#features)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## Project Overview
ClosestGeo makes geography interactive and engaging. By entering two addresses, users can compare distances and learn about the countries that span those distances. This project aims to make geographical exploration simple and accessible, offering a unique way to visualize global connections.

## Features
- **True-size comparison**: the matching country is drawn at its real size between your two places, its extreme points lined up with them.
- **Close matches**: the five closest countries, with any one shown on the map at a click.
- **How many fit?**: see how many copies of any country fit end to end between your places.
- **Move and rotate**: drag the outline anywhere or rotate it; it stays at true size.
- **Address suggestions**, **use my location**, or **pick places on a map**.
- **Country facts**: capital, population, area and a size comparison ("About 1.5× the size of Texas").
- **Map styles**: Simple, Atlas, Standard or Satellite, remembered between visits.
- **Dark mode** that follows your device setting.
- **Miles or kilometers**, remembered between visits.
- **Shareable links** that reopen the same view and show a map preview image in chat apps.
- **Recent searches** on the home page.
- **Daily challenge**: five rounds, the same for everyone each day, with a shareable result.
- **Practice quiz** with Easy, Medium and Hard levels and a streak counter.
- **Stats page** (`/stats.html`) with anonymous counts of matched countries, distances and quiz scores. No addresses, locations or IP addresses are stored.

## How It Works
1. Enter two addresses into the form.
2. Select the preferred distance option:
   - **Either**: Compares against each country's west-east and north-south spans and uses whichever is closer.
   - **West-East**: Compares against west-east spans only.
   - **North-South**: Compares against north-south spans only.
3. Submit the form to view the calculated distance and the country that best represents that span.
4. The map shows both locations with the country's outline drawn at true scale between them, its northernmost/southernmost (or westernmost/easternmost) points lined up with the two addresses.

## Installation
You'll need [Node.js](https://nodejs.org/) 21.7 or newer and a Google API key ([Google Cloud Console](https://console.cloud.google.com/google/maps-apis)) with these APIs enabled:
- **Geocoding API**: looks up typed addresses (server).
- **Maps JavaScript API**: the maps (browser).
- **Places API (New)**: address suggestions (browser). Optional; without it, typing addresses still works.

To run ClosestGeo locally, follow these steps:

1. **Clone the repository**:
    ```bash
    git clone https://github.com/TheFallZ/ClosestGeo.git
    ```
2. **Navigate to the project directory**:
    ```bash
    cd ClosestGeo
    ```
3. **Install dependencies**:
    ```bash
    npm install
    ```
4. **Add your API keys**: copy `.env.example` to `.env` and set `GOOGLE_API_KEY`. Optionally set `GOOGLE_MAPS_BROWSER_KEY` to a separate key restricted to your website for the maps and suggestions.
5. **Start the server**:
    ```bash
    npm start
    ```
6. **Open http://localhost:3000** in your preferred web browser.

### Running the tests
```bash
npm test
```
The tests use Node's built-in test runner and never call Google. They also run automatically on GitHub for every push and pull request (`.github/workflows/test.yml`).

### Limits and caching
Address lookups are cached in `data/geocode-cache.json`, so repeat searches don't call Google again. Each visitor can make up to 60 new lookups per 15 minutes (two per search); change `MAX_LOOKUPS` and `WINDOW_MS` in `lib/geocode.js` to adjust. Searches using map points, "use my location" or address suggestions skip the server lookup entirely, and so does the quiz.

### Updating the country data
`countries/countries.json` lists the countries (name and 2-letter ISO code) and each one's west-east and north-south span. `countries/boundaries.json` holds the outlines drawn on the map. Both are generated from [Natural Earth](https://www.naturalearthdata.com/) public-domain boundaries. `countries/facts.json` (capital, population and area) comes from [Wikidata](https://www.wikidata.org/), also public domain.

To add or remove a country, edit the list in `countries/countries.json` (the distances can be anything) and run:
```bash
npm run build:countries
```
This recalculates every span from the country's extreme points and rebuilds the outlines, the facts and the low-detail world map used for link preview images. Nearby islands count as part of a country; remote territories (such as Hawaii or the Chatham Islands) don't.

## Usage
1. Open http://localhost:3000 in your web browser (with the server running).
2. Enter the first and second addresses.
3. Select the distance option (Both, West-East, North-South).
4. Click "Submit" to see the results.

## Contributing
Contributions are welcome! If you have suggestions for improvements or new features, please create an issue or submit a pull request. Follow these steps to contribute:

1. Fork the repository.
2. Create a new branch:
    ```bash
    git checkout -b feature-branch
    ```
3. Make your changes and commit them:
    ```bash
    git commit -m "Add feature"
    ```
4. Push to the branch:
    ```bash
    git push origin feature-branch
    ```
5. Open a pull request.

Run `npm test` before opening a pull request; the same tests run automatically on GitHub.

## License
ClosestGeo is released under the [MIT License](LICENSE).

Country outlines come from [Natural Earth](https://www.naturalearthdata.com/) and country facts from [Wikidata](https://www.wikidata.org/), both public domain. Maps, address lookups and suggestions are provided by Google Maps Platform under [Google's terms](https://cloud.google.com/maps-platform/terms).

---

Join us on this journey of geographical discovery with ClosestGeo! Whether you're a student, traveler, or geography enthusiast, we hope you find this tool both fun and educational.
