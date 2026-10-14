// Stats page: anonymous usage counts from /stats.json.
(() => {
    const { escapeHtml } = ClosestGeo;
    const $ = (id) => document.getElementById(id);
    const OPTION_NAMES = { both: 'Either span', westEast: 'West–east', northSouth: 'North–south' };
    const DIFFICULTY_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

    const formatDay = (day) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const percent = (part, whole) => (whole ? Math.round(part / whole * 100) : 0);

    // Horizontal bars with the value written beside each one.
    // rows: [{ label, value, text, count }]: value sets the bar length, text is shown beside it and
    // count is how many records the row is based on (defaults to value).
    // Bars are scaled to the largest value, or to scaleMax when given (e.g. 100 for percentages).
    function renderBars(element, rows, emptyText, scaleMax) {
        const max = scaleMax || Math.max(...rows.map(r => r.value), 1);
        if (rows.every(r => !(r.count ?? r.value))) {
            element.innerHTML = `<p class="muted">${escapeHtml(emptyText)}</p>`;
            return;
        }
        element.innerHTML = rows.map(r => `
            <div class="bar-row">
                <span class="bar-label">${escapeHtml(r.label)}</span>
                <span class="bar-track">${r.value ? `<span class="bar-fill" style="width: ${(r.value / max * 100).toFixed(1)}%"></span>` : ''}</span>
                <span class="bar-value">${escapeHtml(r.text)}</span>
            </div>`).join('');
    }

    function renderDays(days) {
        const max = Math.max(...days.map(d => d.count), 1);
        $('days').setAttribute('aria-label', `Searches per day: ${days.map(d => `${formatDay(d.day)} ${d.count}`).join(', ')}`);
        $('days').innerHTML = days.map(d => {
            const tip = `${formatDay(d.day)}: ${d.count} ${d.count === 1 ? 'search' : 'searches'}`;
            return `<span class="day" data-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}">
                <span class="day-bar" style="height: ${d.count ? Math.max(d.count / max * 100, 3).toFixed(1) : 0}%"></span>
            </span>`;
        }).join('');
        $('dayAxis').innerHTML = `<span>${formatDay(days[0].day)}</span><span>Today</span>`;
    }

    async function init() {
        let stats;
        try {
            const response = await fetch('/stats.json');
            if (!response.ok) throw new Error();
            stats = await response.json();
        } catch {
            $('since').textContent = "Couldn't load stats. Check that the server is running and refresh.";
            return;
        }

        const { searches, quiz } = stats;
        const answered = quiz.practice.reduce((sum, d) => sum + d.answered, 0);
        const correct = quiz.practice.reduce((sum, d) => sum + d.correct, 0);

        $('since').textContent = `Counting since ${new Date(`${stats.since}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.`;
        $('tiles').innerHTML = [
            ['Searches', searches.total.toLocaleString()],
            ['Quiz answers', answered.toLocaleString()],
            ['Quiz accuracy', answered ? `${percent(correct, answered)}%` : '–'],
            ['Daily challenges played', quiz.daily.played.toLocaleString()]
        ].map(([label, value]) => `<div class="panel stat-tile"><span class="stat-value">${value}</span><span class="muted">${label}</span></div>`).join('');

        renderDays(searches.last30Days);
        renderBars($('countries'), searches.topCountries.map(c => ({ label: c.name, value: c.count, text: c.count.toLocaleString() })), 'No searches yet.');
        renderBars($('distances'), searches.byDistance.map(d => ({ label: d.range, value: d.count, text: d.count.toLocaleString() })), 'No searches yet.');
        renderBars($('options'), searches.byOption.map(o => ({ label: OPTION_NAMES[o.option], value: o.count, text: o.count.toLocaleString() })), 'No searches yet.');
        renderBars($('accuracy'), quiz.practice.map(d => ({
            label: DIFFICULTY_NAMES[d.difficulty],
            value: d.answered ? percent(d.correct, d.answered) : 0,
            count: d.answered,
            text: d.answered ? `${percent(d.correct, d.answered)}% of ${d.answered.toLocaleString()}` : 'None yet'
        })), 'No practice answers yet.', 100);
        renderBars($('dailyScores'), quiz.daily.scores.map(s => ({ label: `${s.score} of 5`, value: s.count, text: s.count.toLocaleString() })), 'No daily challenges finished yet.');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
