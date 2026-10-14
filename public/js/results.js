// Results page: shows the best-matching country at true size between the two places, with
// close alternatives, a "how many fit" view, rotation/dragging, units and a shareable link.
(() => {
    const { escapeHtml, formatDistance, distanceWords } = ClosestGeo;
    const METERS_PER_MILE = 1609.344;
    const MAX_COPIES = 100;
    const KM2_PER_MI2 = 2.589988;
    // Familiar places to compare a country's area with (km²)
    const AREA_REFERENCES = [
        ['Manhattan', 59], ['Washington, D.C.', 177], ['Rhode Island', 4001], ['Connecticut', 14357],
        ['Belgium', 30689], ['Ireland', 70273], ['Portugal', 92212], ['the United Kingdom', 243610],
        ['Germany', 357588], ['California', 423970], ['Texas', 695662], ['Alaska', 1723337],
        ['Australia', 7692024], ['the United States', 9833520], ['Russia', 17098246]
    ];
    // Well-known countries offered first as the "how many fit" yardstick
    const FIT_DEFAULTS = ['BE', 'CH', 'NL', 'IE', 'PT', 'AT', 'GB', 'IT', 'DE', 'JP', 'FR', 'ES', 'EG', 'MX', 'AU', 'BR', 'US', 'CA', 'RU'];

    const params = new URLSearchParams(window.location.search);
    const shapes = new Map(); // country code -> boundary geometry
    let map;
    let result;
    let countries = [];
    let pointA;
    let pointB;

    // The country currently shown, and where it is on the map
    const view = {
        match: null,
        prepared: null,
        aligned: null,
        center: null,
        rotationOffset: 0,
        polygon: null,
        dots: [],
        copies: [],
        fitCode: null
    };

    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        const input = {
            address1: params.get('address1'),
            address2: params.get('address2'),
            lat1: params.get('lat1'),
            lng1: params.get('lng1'),
            lat2: params.get('lat2'),
            lng2: params.get('lng2'),
            distanceOption: params.get('distanceOption') || 'both'
        };
        const hasPlace = (n) => input[`address${n}`] || (input[`lat${n}`] && input[`lng${n}`]);
        if (!hasPlace(1) || !hasPlace(2)) {
            showError('Missing addresses', 'Enter both addresses to search.');
            return;
        }

        ClosestGeo.setUpUnitToggle(() => {
            if (view.match) renderCard();
        });
        try {
            const [data, countryList] = await Promise.all([
                ClosestGeo.postJson('/find-country', input),
                fetch('/countries').then(response => response.json()),
                ClosestGeo.loadGoogleMaps()
            ]);
            result = data;
            countries = countryList;
            map = ClosestGeo.createMap($('map'));
            [pointA, pointB] = result.locations.map(l => ({ lat: l.latitude, lng: l.longitude }));

            result.locations.forEach((location, i) => {
                ClosestGeo.pinMarker(map, { lat: location.latitude, lng: location.longitude }, i === 0 ? 'A' : 'B', location.address);
            });
            ClosestGeo.dashedLine(map, pointA, pointB);

            const shown = result.matches.find(m => m.countryCode === params.get('show')) || result.matches[0];
            await showMatch(shown);
            $('info').hidden = false;
            $('loading').hidden = true;

            saveToHistory();
            setUpControls();
            setUpFitPicker();
            if (params.get('fit')) await showFit(params.get('fit'));
        } catch (error) {
            showError('Search failed', error.message);
        }
    }

    function showError(title, message) {
        $('loading').hidden = true;
        $('errorTitle').textContent = title;
        $('errorMessage').textContent = message;
        $('error').hidden = false;
    }

    async function getShape(code) {
        if (!shapes.has(code)) {
            const response = await fetch(`/country-shape/${code}`);
            if (!response.ok) throw new Error(`No outline available for ${code}.`);
            shapes.set(code, await response.json());
        }
        return shapes.get(code);
    }

    // ---------- The shown country ----------

    async function showMatch(match) {
        if (view.fitCode) hideFit();
        view.match = match;
        view.prepared = Shape.prepare(await getShape(match.countryCode), match.distanceOptionUsed);
        view.aligned = Shape.align(view.prepared, pointA, pointB);
        view.center = view.aligned.center;
        view.rotationOffset = 0;
        $('rotate').value = 0;

        clearShown();
        const placed = placeShown();
        view.polygon = ClosestGeo.countryPolygon(map, placed.rings, { draggable: true });
        view.dots = placed.extremes.map(p => ClosestGeo.dotMarker(map, p));
        listenForDrag(view.polygon);
        fitMap(placed.rings);

        renderCard();
        updateUrl();
    }

    function placeShown() {
        return Shape.place(view.prepared, view.center, view.aligned.rotation + view.rotationOffset);
    }

    function redrawShown() {
        const placed = placeShown();
        view.polygon.setPaths(placed.rings);
        view.dots.forEach((dot, i) => dot.setPosition(placed.extremes[i]));
    }

    function clearShown() {
        if (view.polygon) view.polygon.setMap(null);
        view.dots.forEach(dot => dot.setMap(null));
        view.polygon = null;
        view.dots = [];
    }

    // Google moves a dragged polygon without regard to true size, so once the drag ends the
    // shape is placed again at true size around its new center
    function listenForDrag(polygon) {
        let startCenter;
        polygon.addListener('dragstart', () => {
            startCenter = polygonCenter(polygon);
            view.dots.forEach(dot => dot.setVisible(false));
        });
        polygon.addListener('dragend', () => {
            const endCenter = polygonCenter(polygon);
            const moved = {
                lat: view.center.lat + endCenter.lat - startCenter.lat,
                lng: Shape.normalizeAngle(view.center.lng + Shape.normalizeAngle(endCenter.lng - startCenter.lng))
            };
            view.center = Shape.clampCenter(view.prepared, moved, view.aligned.rotation + view.rotationOffset);
            redrawShown();
            view.dots.forEach(dot => dot.setVisible(true));
        });
    }

    function polygonCenter(polygon) {
        const bounds = new google.maps.LatLngBounds();
        polygon.getPaths().forEach(path => path.forEach(point => bounds.extend(point)));
        const center = bounds.getCenter();
        return { lat: center.lat(), lng: center.lng() };
    }

    // Fits the map to both places and the given outlines, leaving room for the card on wide screens
    function fitMap(rings) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(pointA);
        bounds.extend(pointB);
        rings.forEach(ring => ring.forEach(p => bounds.extend(p)));
        const wide = window.matchMedia('(min-width: 721px)').matches;
        map.fitBounds(bounds, wide ? { top: 50, right: 50, bottom: 50, left: 380 } : 30);
    }

    // ---------- Card ----------

    function renderCard() {
        const match = view.match;
        const isWestEast = match.distanceOptionUsed === 'West-East';
        const isBest = match === result.matches[0];
        const difference = Math.abs(match.spanMiles - result.distanceMiles);

        $('flag').src = match.flagUrl;
        $('flag').alt = `Flag of ${match.country}`;
        $('countryName').textContent = match.country;
        $('matchLabel').textContent = isBest ? 'Closest match' : `Match ${result.matches.indexOf(match) + 1} of ${result.matches.length}`;
        $('yourDistance').textContent = formatDistance(result.distanceMiles);
        $('spanLabel').textContent = `${match.country}, ${isWestEast ? 'west–east' : 'north–south'}`;
        $('spanValue').textContent = formatDistance(match.spanMiles);
        $('difference').textContent = Math.round(difference) === 0
            ? 'Same length as your distance.'
            : `${distanceWords(difference)} ${match.spanMiles > result.distanceMiles ? 'longer' : 'shorter'} than your distance.`;

        $('matches').innerHTML = result.matches.map((m, i) => `
            <li>
                <button type="button" data-index="${i}" ${m === match ? 'aria-current="true"' : ''}>
                    <img src="${escapeHtml(m.flagUrl)}" alt="">
                    <span class="match-name">${escapeHtml(m.country)}</span>
                    <span class="match-span">${formatDistance(m.spanMiles)} ${m.distanceOptionUsed === 'West-East' ? 'W–E' : 'N–S'}</span>
                </button>
            </li>`).join('');

        $('route').innerHTML = result.locations.map((l, i) =>
            `<li><strong>${i === 0 ? 'A' : 'B'}</strong> ${escapeHtml(l.address)}</li>`).join('');

        renderFacts();
        renderLegend();
        renderFitText();
        document.title = `${match.country} · ClosestGeo`;
    }

    // Capital, population, area and an area comparison with a familiar place
    function renderFacts() {
        const country = countries.find(c => c.countryCode === view.match.countryCode);
        const facts = country && country.facts;
        $('facts').hidden = !facts;
        $('factsComparison').hidden = !facts;
        if (!facts) return;

        const unit = ClosestGeo.getUnit();
        const rows = [];
        if (facts.capitals.length) rows.push([facts.capitals.length > 1 ? 'Capitals' : 'Capital', facts.capitals.join(' · ')]);
        if (facts.population) rows.push(['Population', formatPopulation(facts.population)]);
        if (facts.areaKm2) {
            const area = unit === 'km' ? facts.areaKm2 : facts.areaKm2 / KM2_PER_MI2;
            rows.push(['Area', `${formatArea(area)} ${unit}²`]);
        }
        $('facts').innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
        $('factsComparison').textContent = facts.areaKm2 ? compareArea(view.match.country, facts.areaKm2) : '';
    }

    function formatPopulation(people) {
        if (people >= 1e9) return `${(people / 1e9).toFixed(2)} billion`;
        if (people >= 1e6) return `${(people / 1e6).toFixed(1)} million`;
        return people.toLocaleString();
    }

    const formatArea = (area) => (area < 10 ? area.toFixed(2) : Math.round(area).toLocaleString());

    // "About 1.5× the size of Texas", using whichever familiar place is closest in size
    function compareArea(name, areaKm2) {
        const others = AREA_REFERENCES.filter(([place]) => place.replace(/^the /, '') !== name);
        const [place, referenceKm2] = others.reduce((best, ref) =>
            Math.abs(Math.log(areaKm2 / ref[1])) < Math.abs(Math.log(areaKm2 / best[1])) ? ref : best);
        const ratio = areaKm2 / referenceKm2;
        if (ratio >= 0.9 && ratio <= 1.1) return `About the same size as ${place}.`;
        if (ratio > 1) return `About ${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}× the size of ${place}.`;
        return `About ${Math.round(ratio * 100)}% of the size of ${place}.`;
    }

    function renderLegend() {
        const isWestEast = view.match.distanceOptionUsed === 'West-East';
        const fitCountry = view.fitCode && countries.find(c => c.countryCode === view.fitCode);
        const items = [`<li><span class="swatch swatch-line"></span> Straight-line distance</li>`];
        if (fitCountry) {
            items.push(`<li><span class="swatch swatch-country"></span> ${escapeHtml(fitCountry.name)}, actual size</li>`);
        } else {
            items.push(`<li><span class="swatch swatch-country"></span> ${escapeHtml(view.match.country)}, actual size</li>`);
            items.push(`<li><span class="swatch swatch-extreme"></span> ${isWestEast ? 'Westernmost and easternmost' : 'Northernmost and southernmost'} points</li>`);
        }
        $('legend').innerHTML = items.join('');
    }

    function setUpControls() {
        $('matches').addEventListener('click', (event) => {
            const button = event.target.closest('button[data-index]');
            if (button) showMatch(result.matches[Number(button.dataset.index)]);
        });

        $('rotate').addEventListener('input', (event) => {
            view.rotationOffset = Number(event.target.value);
            view.center = Shape.clampCenter(view.prepared, view.center, view.aligned.rotation + view.rotationOffset);
            redrawShown();
        });

        $('resetShape').addEventListener('click', () => {
            view.center = view.aligned.center;
            view.rotationOffset = 0;
            $('rotate').value = 0;
            redrawShown();
        });

        $('copyLink').addEventListener('click', copyLink);
    }

    // ---------- How many fit ----------

    function setUpFitPicker() {
        const select = $('fitCountry');
        select.innerHTML = [...countries]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => `<option value="${escapeHtml(c.countryCode)}">${escapeHtml(c.name)}</option>`)
            .join('');
        select.value = params.get('fit') || defaultFitCountry();
        renderFitText();

        select.addEventListener('change', () => {
            renderFitText();
            if (view.fitCode) showFit(select.value);
        });
        $('fitToggle').addEventListener('click', () => {
            if (view.fitCode) {
                hideFit();
                showMatch(view.match);
            } else {
                showFit(select.value);
            }
        });
    }

    const spanKey = () => (view.match.distanceOptionUsed === 'West-East' ? 'westEast' : 'northSouth');

    // A familiar country that fits a handful of times, so the comparison is easy to picture
    function defaultFitCountry() {
        const fitCount = (c) => result.distanceMiles / c.distance[spanKey()];
        const score = (c) => Math.abs(Math.log(fitCount(c) / 6));
        const familiar = countries.filter(c => FIT_DEFAULTS.includes(c.countryCode) && fitCount(c) >= 2);
        const pool = familiar.length ? familiar : countries.filter(c => fitCount(c) >= 2);
        const best = pool.reduce((a, b) => (score(b) < score(a) ? b : a), pool[0] || countries[0]);
        return best.countryCode;
    }

    function renderFitText() {
        const country = countries.find(c => c.countryCode === $('fitCountry').value);
        if (!country || !view.match) return;
        const orientation = view.match.distanceOptionUsed === 'West-East' ? 'west–east' : 'north–south';
        const count = Math.floor(result.distanceMiles / country.distance[spanKey()]);
        $('fitText').textContent = count === 0
            ? `Your distance is shorter than ${country.name}'s ${orientation} span.`
            : `${country.name} fits ${count.toLocaleString()} ${count === 1 ? 'time' : 'times'} end to end (${orientation}).`;
        $('fitToggle').disabled = count === 0 || count > MAX_COPIES;
        if (count > MAX_COPIES) $('fitText').textContent += ' Too many to draw on the map.';
    }

    // Draws copies of a country end to end along the line, centered between the two places
    async function showFit(code) {
        const country = countries.find(c => c.countryCode === code);
        if (!country) return;
        const orientation = view.match.distanceOptionUsed;
        const prepared = Shape.prepare(await getShape(code), orientation);
        const spanMiles = prepared.span / METERS_PER_MILE;
        const count = Math.floor(result.distanceMiles / spanMiles);
        if (count < 1 || count > MAX_COPIES) return;

        removeCopies();
        clearShown();
        const leftover = result.distanceMiles - count * spanMiles;
        const allRings = [];
        for (let i = 0; i < count; i++) {
            const start = (leftover / 2 + i * spanMiles) / result.distanceMiles;
            const end = start + spanMiles / result.distanceMiles;
            const { center, rotation } = Shape.align(prepared, Shape.interpolate(pointA, pointB, start), Shape.interpolate(pointA, pointB, end));
            const placed = Shape.place(prepared, center, rotation);
            view.copies.push(ClosestGeo.countryPolygon(map, placed.rings, { strokeWeight: 1.5, fillOpacity: 0.25 }));
            allRings.push(...placed.rings);
        }
        fitMap(allRings);

        view.fitCode = code;
        $('fitSection').open = true;
        $('fitCountry').value = code;
        $('fitToggle').textContent = `Back to ${view.match.country}`;
        $('adjust').hidden = true;
        renderLegend();
        updateUrl();
    }

    function removeCopies() {
        view.copies.forEach(polygon => polygon.setMap(null));
        view.copies = [];
    }

    function hideFit() {
        removeCopies();
        view.fitCode = null;
        $('fitToggle').textContent = 'Show on map';
        $('adjust').hidden = false;
    }

    // ---------- Link and history ----------

    function updateUrl() {
        const url = new URL(window.location.href);
        if (view.match && view.match !== result.matches[0]) {
            url.searchParams.set('show', view.match.countryCode);
        } else {
            url.searchParams.delete('show');
        }
        if (view.fitCode) {
            url.searchParams.set('fit', view.fitCode);
        } else {
            url.searchParams.delete('fit');
        }
        history.replaceState(null, '', url);
    }

    async function copyLink() {
        const button = $('copyLink');
        try {
            await navigator.clipboard.writeText(window.location.href);
            button.textContent = 'Link copied';
        } catch {
            window.prompt('Copy this link:', window.location.href);
            return;
        }
        setTimeout(() => { button.textContent = 'Copy link'; }, 2000);
    }

    function saveToHistory() {
        const url = new URL(window.location.href);
        url.searchParams.delete('show');
        url.searchParams.delete('fit');
        ClosestGeo.addToHistory({
            url: url.pathname + url.search,
            from: result.locations[0].address,
            to: result.locations[1].address,
            country: result.country
        });
    }
})();
