// Quiz: a country outline is drawn at true size between two random cities; guess which it is.
// Searches use city coordinates, so no address lookups (and no API cost) are needed.
(() => {
    const { escapeHtml, formatDistance } = ClosestGeo;
    const $ = (id) => document.getElementById(id);

    const MIN_MILES = 250;
    const MAX_MILES = 3000;
    const CHOICES = 4;

    // [name, latitude, longitude]
    const CITIES = [
        ['New York', 40.71, -74.01], ['Los Angeles', 34.05, -118.24], ['Chicago', 41.88, -87.63],
        ['Houston', 29.76, -95.37], ['Miami', 25.76, -80.19], ['Seattle', 47.61, -122.33],
        ['Denver', 39.74, -104.99], ['Atlanta', 33.75, -84.39], ['Toronto', 43.65, -79.38],
        ['Montreal', 45.50, -73.57], ['Vancouver', 49.28, -123.12], ['Mexico City', 19.43, -99.13],
        ['Havana', 23.11, -82.37], ['Bogotá', 4.71, -74.07], ['Lima', -12.05, -77.04],
        ['Santiago', -33.45, -70.67], ['Buenos Aires', -34.60, -58.38], ['São Paulo', -23.55, -46.63],
        ['Rio de Janeiro', -22.91, -43.17], ['London', 51.51, -0.13], ['Paris', 48.86, 2.35],
        ['Madrid', 40.42, -3.70], ['Lisbon', 38.72, -9.14], ['Rome', 41.90, 12.50],
        ['Berlin', 52.52, 13.40], ['Stockholm', 59.33, 18.07], ['Warsaw', 52.23, 21.01],
        ['Athens', 37.98, 23.73], ['Istanbul', 41.01, 28.98], ['Moscow', 55.76, 37.62],
        ['Cairo', 30.04, 31.24], ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82],
        ['Addis Ababa', 9.03, 38.74], ['Johannesburg', -26.20, 28.05], ['Cape Town', -33.92, 18.42],
        ['Casablanca', 33.57, -7.59], ['Dubai', 25.20, 55.27], ['Riyadh', 24.71, 46.68],
        ['Tehran', 35.69, 51.39], ['Karachi', 24.86, 67.01], ['Delhi', 28.61, 77.21],
        ['Mumbai', 19.08, 72.88], ['Kolkata', 22.57, 88.36], ['Bangkok', 13.76, 100.50],
        ['Singapore', 1.35, 103.82], ['Jakarta', -6.21, 106.85], ['Manila', 14.60, 120.98],
        ['Hong Kong', 22.32, 114.17], ['Shanghai', 31.23, 121.47], ['Beijing', 39.90, 116.40],
        ['Seoul', 37.57, 126.98], ['Tokyo', 35.68, 139.69], ['Sydney', -33.87, 151.21],
        ['Melbourne', -37.81, 144.96], ['Perth', -31.95, 115.86], ['Auckland', -36.85, 174.76]
    ];

    let map;
    let drawn = [];
    let round = 0;
    let score = 0;
    let current = null;

    document.addEventListener('DOMContentLoaded', start);
    $('nextRound').addEventListener('click', nextRound);
    $('retry').addEventListener('click', () => {
        $('error').hidden = true;
        start();
    });
    $('choices').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-code]');
        if (button) answer(button);
    });
    ClosestGeo.setUpUnitToggle(() => {
        if (!current) return;
        renderPrompt();
        if (!$('reveal').hidden) renderReveal();
    });

    async function start() {
        $('loading').hidden = false;
        try {
            await ClosestGeo.loadGoogleMaps();
            if (!map) map = ClosestGeo.createMap($('map'));
            await nextRound();
        } catch (error) {
            showError(error.message);
        }
    }

    function showError(message) {
        $('loading').hidden = true;
        $('errorMessage').textContent = message;
        $('error').hidden = false;
    }

    const toPoint = ([, lat, lng]) => ({ lat, lng });
    const shuffle = (items) => items
        .map(item => ({ item, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ item }) => item);

    // Two random cities a sensible distance apart
    function pickCities() {
        for (;;) {
            const [a, b] = shuffle(CITIES).slice(0, 2);
            const miles = Shape.distance(toPoint(a), toPoint(b)) / 1609.344;
            if (miles >= MIN_MILES && miles <= MAX_MILES) return [a, b];
        }
    }

    async function nextRound() {
        const [cityA, cityB] = pickCities();
        $('loading').hidden = false;
        try {
            const result = await ClosestGeo.postJson('/find-country', {
                address1: cityA[0], lat1: cityA[1], lng1: cityA[2],
                address2: cityB[0], lat2: cityB[1], lng2: cityB[2],
                distanceOption: 'both'
            });
            const geometry = await (await fetch(`/country-shape/${result.countryCode}`)).json();
            round++;
            current = {
                result,
                answer: result.matches[0],
                choices: shuffle([result.matches[0], ...shuffle(result.matches.slice(1)).slice(0, CHOICES - 1)])
            };
            draw(result, geometry);
            renderQuestion();
            $('loading').hidden = true;
            $('quizCard').hidden = false;
        } catch (error) {
            showError(error.message);
        }
    }

    function draw(result, geometry) {
        drawn.forEach(item => item.setMap(null));
        const [a, b] = result.locations.map(l => ({ lat: l.latitude, lng: l.longitude }));
        const prepared = Shape.prepare(geometry, result.distanceOptionUsed);
        const { center, rotation } = Shape.align(prepared, a, b);
        const placed = Shape.place(prepared, center, rotation);

        drawn = [
            ClosestGeo.pinMarker(map, a, 'A', result.locations[0].address),
            ClosestGeo.pinMarker(map, b, 'B', result.locations[1].address),
            ClosestGeo.dashedLine(map, a, b),
            ClosestGeo.countryPolygon(map, placed.rings)
        ];

        const bounds = new google.maps.LatLngBounds();
        [a, b, ...placed.rings.flat()].forEach(p => bounds.extend(p));
        const wide = window.matchMedia('(min-width: 721px)').matches;
        map.fitBounds(bounds, wide ? { top: 50, right: 50, bottom: 50, left: 380 } : 30);
    }

    function renderQuestion() {
        const { result, choices } = current;
        $('progress').textContent = `Round ${round} · Score ${score} of ${round - 1}`;
        renderPrompt();
        $('choices').innerHTML = choices.map(c =>
            `<button type="button" class="choice-button" data-code="${escapeHtml(c.countryCode)}">${escapeHtml(c.country)}</button>`).join('');
        $('reveal').hidden = true;
    }

    function answer(button) {
        if (!$('reveal').hidden) return;
        const { answer: correct } = current;
        current.isRight = button.dataset.code === correct.countryCode;
        if (current.isRight) score++;

        [...$('choices').children].forEach(b => {
            b.disabled = true;
            if (b.dataset.code === correct.countryCode) b.classList.add('is-correct');
            else if (b === button) b.classList.add('is-wrong');
        });

        $('revealFlag').src = correct.flagUrl;
        $('revealFlag').alt = `Flag of ${correct.country}`;
        renderReveal();
        $('progress').textContent = `Round ${round} · Score ${score} of ${round}`;
        $('reveal').hidden = false;
        $('nextRound').focus();
    }

    function renderPrompt() {
        const { result } = current;
        $('prompt').textContent = `Drawn at actual size between ${result.locations[0].address} (A) and ${result.locations[1].address} (B), ${formatDistance(result.distanceMiles)} apart.`;
    }

    function renderReveal() {
        const { answer: correct, isRight } = current;
        const orientation = correct.distanceOptionUsed === 'West-East' ? 'west–east' : 'north–south';
        $('revealText').textContent = `${isRight ? 'Correct!' : 'Not quite.'} It's ${correct.country}, ${formatDistance(correct.spanMiles)} ${orientation}.`;
    }
})();
