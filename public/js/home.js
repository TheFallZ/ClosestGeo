// Home page: the search form, with address suggestions, "use my location", picking places on a
// map, and recent searches.
(() => {
    const { escapeHtml } = ClosestGeo;
    const $ = (id) => document.getElementById(id);
    const MIN_SUGGESTION_LENGTH = 3;

    const fields = [1, 2].map(n => ({
        input: $(`address${n}`),
        list: $(`suggestions${n}`),
        label: n === 1 ? 'A' : 'B',
        predictions: [],
        active: -1,
        timer: null
    }));

    let places = null;       // Google Places library, once loaded (stays null if unavailable)
    let sessionToken = null; // groups suggestion requests into one billed session
    let pickerMap = null;
    let markers = [null, null];
    let nextPick = 0;

    const formatCoordinates = (lat, lng) =>
        `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}° ${lng >= 0 ? 'E' : 'W'}`;

    // ---------- Places with known coordinates ----------

    function setPlace(field, label, lat, lng) {
        field.input.value = label;
        field.input.dataset.lat = lat;
        field.input.dataset.lng = lng;
        updateMarkers();
    }

    function clearCoordinates(field) {
        delete field.input.dataset.lat;
        delete field.input.dataset.lng;
        updateMarkers();
    }

    function showMessage(text) {
        $('formMessage').textContent = text;
        $('formMessage').hidden = !text;
    }

    // ---------- Form ----------

    $('addressForm').addEventListener('submit', (event) => {
        event.preventDefault(); // Prevent the default form submission behavior

        const params = new URLSearchParams();
        fields.forEach((field, i) => {
            const n = i + 1;
            params.set(`address${n}`, field.input.value.trim());
            if (field.input.dataset.lat) {
                params.set(`lat${n}`, field.input.dataset.lat);
                params.set(`lng${n}`, field.input.dataset.lng);
            }
        });
        params.set('distanceOption', document.querySelector('input[name="distanceOption"]:checked').value);

        // Redirect to results page with query parameters
        window.location.href = `results.html?${params}`;
    });

    // ---------- Use my location ----------

    $('useLocation').addEventListener('click', () => {
        if (!navigator.geolocation) {
            showMessage("Your browser can't share your location.");
            return;
        }
        const button = $('useLocation');
        button.textContent = 'Locating…';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setPlace(fields[0], 'My location', position.coords.latitude, position.coords.longitude);
                button.textContent = 'Use my location';
                showMessage('');
            },
            () => {
                button.textContent = 'Use my location';
                showMessage("Couldn't get your location. Check that location access is allowed for this site.");
            },
            { timeout: 10000 }
        );
    });

    // ---------- Address suggestions (Google Places) ----------

    ClosestGeo.loadGoogleMaps()
        .then(() => google.maps.importLibrary('places'))
        .then((library) => {
            places = library;
            sessionToken = new places.AutocompleteSessionToken();
        })
        .catch(() => {
            // Suggestions are optional; typed addresses still work without them
        });

    fields.forEach(field => {
        field.input.addEventListener('input', () => {
            clearCoordinates(field);
            clearTimeout(field.timer);
            field.timer = setTimeout(() => fetchSuggestions(field), 200);
        });
        field.input.addEventListener('keydown', (event) => handleSuggestionKeys(field, event));
        field.input.addEventListener('blur', () => setTimeout(() => hideSuggestions(field), 150));
        field.list.addEventListener('mousedown', (event) => {
            const item = event.target.closest('li[data-index]');
            if (!item) return;
            event.preventDefault(); // keep focus in the input
            chooseSuggestion(field, Number(item.dataset.index));
        });
    });

    async function fetchSuggestions(field) {
        const text = field.input.value.trim();
        if (!places || text.length < MIN_SUGGESTION_LENGTH) {
            hideSuggestions(field);
            return;
        }
        try {
            const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: text, sessionToken });
            if (field.input.value.trim() !== text) return; // the user kept typing
            field.predictions = suggestions.map(s => s.placePrediction).filter(Boolean);
            renderSuggestions(field);
        } catch {
            hideSuggestions(field);
        }
    }

    function renderSuggestions(field) {
        field.active = -1;
        if (!field.predictions.length) {
            hideSuggestions(field);
            return;
        }
        field.list.innerHTML = field.predictions.map((p, i) =>
            `<li role="option" id="${field.list.id}-${i}" data-index="${i}">${escapeHtml(p.text.toString())}</li>`).join('');
        field.list.hidden = false;
        field.input.setAttribute('aria-expanded', 'true');
    }

    function hideSuggestions(field) {
        field.list.hidden = true;
        field.predictions = [];
        field.active = -1;
        field.input.setAttribute('aria-expanded', 'false');
        field.input.removeAttribute('aria-activedescendant');
    }

    function handleSuggestionKeys(field, event) {
        if (field.list.hidden) return;
        const count = field.predictions.length;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            field.active = (field.active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
            [...field.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === field.active)));
            field.input.setAttribute('aria-activedescendant', `${field.list.id}-${field.active}`);
        } else if (event.key === 'Enter' && field.active >= 0) {
            event.preventDefault();
            chooseSuggestion(field, field.active);
        } else if (event.key === 'Escape') {
            hideSuggestions(field);
        }
    }

    async function chooseSuggestion(field, index) {
        const prediction = field.predictions[index];
        hideSuggestions(field);
        if (!prediction) return;
        const label = prediction.text.toString();
        field.input.value = label;
        try {
            const place = prediction.toPlace();
            await place.fetchFields({ fields: ['location'] });
            setPlace(field, label, place.location.lat(), place.location.lng());
        } catch {
            // Fall back to looking the typed label up on the server
        }
        sessionToken = new places.AutocompleteSessionToken();
    }

    // ---------- Pick places on a map ----------

    $('pickOnMap').addEventListener('click', async () => {
        const picker = $('picker');
        picker.hidden = !picker.hidden;
        $('pickOnMap').setAttribute('aria-expanded', String(!picker.hidden));
        if (picker.hidden || pickerMap) return;

        try {
            await ClosestGeo.loadGoogleMaps();
        } catch (error) {
            showMessage(error.message);
            return;
        }
        pickerMap = ClosestGeo.createMap($('pickerMap'), { fullscreenControl: false, draggableCursor: 'crosshair' });
        pickerMap.addListener('click', (event) => {
            // Fill whichever place is still empty, otherwise alternate between A and B
            const empty = fields.findIndex(f => !f.input.dataset.lat);
            const index = empty === -1 ? nextPick : empty;
            const lat = event.latLng.lat();
            const lng = event.latLng.lng();
            setPlace(fields[index], `Map point (${formatCoordinates(lat, lng)})`, lat, lng);
            nextPick = index === 0 ? 1 : 0;
        });
        updateMarkers();
    });

    function updateMarkers() {
        if (!pickerMap) return;
        fields.forEach((field, i) => {
            if (markers[i]) markers[i].setMap(null);
            markers[i] = null;
            if (field.input.dataset.lat) {
                const position = { lat: Number(field.input.dataset.lat), lng: Number(field.input.dataset.lng) };
                markers[i] = ClosestGeo.pinMarker(pickerMap, position, field.label, field.input.value);
            }
        });
    }

    // ---------- Recent searches ----------

    function renderHistory() {
        const history = ClosestGeo.loadHistory();
        $('history').hidden = !history.length;
        $('historyList').innerHTML = history.map(item => `
            <li>
                <a href="${escapeHtml(item.url)}">${escapeHtml(item.from)} → ${escapeHtml(item.to)}</a>
                <span class="muted">${escapeHtml(item.country)}</span>
            </li>`).join('');
    }

    $('clearHistory').addEventListener('click', () => {
        ClosestGeo.clearHistory();
        renderHistory();
    });

    renderHistory();
})();
