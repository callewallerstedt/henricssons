/* Internal quote review. This panel has no customer-send action. */
function renderQuoteAgentPanel(container, item) {
    const id = item.form_id;
    if (!id) return;
    const panel = $('<section>').addClass('quote-agent-panel');
    const heading = $('<div>').addClass('quote-agent-heading').append($('<h3>').text('Agent Svar'), $('<span>').text('Agent Test · internt'));
    const hint = $('<p>').addClass('quote-agent-muted').text('Agenten söker i Niclas mejl och offertbilagor. Du granskar svaret och öppnar ett oskickat mejlutkast.');
    const controls = $('<div>').addClass('quote-agent-actions');
    const runButton = $('<button type="button">').addClass('btn').text('Agent Svar');
    const progress = $('<span>').addClass('quote-agent-muted').attr('role', 'status');
    controls.append(runButton, progress);
    const output = $('<div>').addClass('quote-agent-output');
    const feedbackBox = $('<div>').addClass('quote-agent-feedback');
    const feedbackInput = $('<textarea rows="3" maxlength="4000">').attr('placeholder', 'Vad blev fel? Vad ska agenten tänka på nästa gång?').attr('aria-label', 'Feedback till agenten');
    const scope = $('<select>').attr('aria-label', 'När feedbacken gäller').append($('<option value="global">').text('Generellt – alla förfrågningar'), $('<option value="model">').text('För den här modellen'));
    const save = $('<button type="button">').addClass('btn btn-secondary').text('Spara minne');
    const saveAndRun = $('<button type="button">').addClass('btn').text('Spara och kör igen');
    const feedbackStatus = $('<p>').addClass('quote-agent-muted').attr('role', 'status');
    const memories = $('<details>').append($('<summary>').text('Sparade minnen som agenten läser'));
    const memoryList = $('<div>').addClass('quote-agent-memory-list');
    memories.append(memoryList);
    feedbackBox.append($('<h4>').text('Feedback till agenten'), $('<p>').addClass('quote-agent-muted').text('Sparas i databasen och läses vid varje körning. Feedback ändrar nästa utkast; ett redan skapat utkast uppdateras när du kör igen.'), feedbackInput, scope, $('<div>').addClass('quote-agent-actions').append(save, saveAndRun), feedbackStatus, memories);
    panel.append(heading, hint, controls, output, feedbackBox);
    container.append(panel);
    let timer = null, pdfUrl = null, running = false, closed = false;
    const endpoint = `${API_BASE}/api/quote_agent/submission/${encodeURIComponent(id)}`;
    async function requestJson(url, options) {
        const response = await adminFetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }
    function setBusy(value) {
        running = value;
        runButton.prop('disabled', value).text(value ? 'Agenten arbetar…' : 'Kör Agent Svar igen');
        saveAndRun.prop('disabled', value);
        progress.text(value ? 'Söker, läser underlag och granskar utkastet. Det kan ta några minuter.' : '');
    }
    function addList(title, rows) {
        if (!rows || !rows.length) return;
        output.append($('<h4>').text(title), $('<ul>').append(rows.map(text => $('<li>').text(text))));
    }
    async function display(data) {
        if (closed) return;
        if (data.state === 'running' || data.state === 'queued') {
            setBusy(true);
            if (timer) clearTimeout(timer);
            timer = setTimeout(load, 3000);
            return;
        }
        setBusy(false);
        if (!data.result) { runButton.text('Agent Svar'); return; }
        output.empty();
        if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
        const result = data.result;
        output.append($('<span>').addClass('quote-agent-safety').text(result.safety_level || 'kräver Niclas'));
        output.append($('<h4>').text('Bedömning'), $('<p>').text(result.explanation || result.summary || ''));
        let quoteHeading = null;
        if (data.has_pdf) {
            quoteHeading = $('<h4>').text('Offertbilaga · originalmall');
            output.append($('<button type="button">').addClass('btn btn-secondary').text('Visa offert-PDF ↓').on('click', () => quoteHeading[0].scrollIntoView({behavior:'smooth',block:'start'})));
        } else {
            output.append($('<p>').addClass('quote-agent-muted').text(result.decision === 'ask_customer' ? 'Ingen offertbilaga ännu – kunden behöver först komplettera uppgifterna.' : 'Ingen offertbilaga skapad. Se agentens bedömning och kontrollpunkter.'));
        }
        addList('Kunden behöver komplettera', result.missing_customer_fields);
        addList('Kontroll för Niclas', result.internal_blockers);
        if (result.quote_sources && result.quote_sources.length) {
            addList('Tidigare offerter som används', result.quote_sources.map(source => `${source.filename} · ${source.date || 'datum saknas'} · offert ${source.quote_number || '—'}`));
        }
        if (result.facts && result.facts.length) {
            const sources = $('<details>').append($('<summary>').text('Visa källbelagda uppgifter'));
            const list = $('<div>');
            result.facts.forEach(fact => list.append($('<p>').append($('<strong>').text(fact.claim), $('<blockquote>').text(fact.excerpt))));
            sources.append(list); output.append(sources);
        }
        const email = result.email || {};
        if (email.body) {
            output.append($('<h4>').text('Föreslaget kundsvar'), $('<p>').addClass('quote-agent-subject').text(email.subject || ''));
            output.append($('<div>').addClass('quote-agent-mail').text(email.body));
            const actions = $('<div>').addClass('quote-agent-actions');
            if (data.draft_url) actions.append($('<a>').addClass('btn').attr({href: data.draft_url, download: 'Henricssons-mejlutkast.eml'}).text(data.has_pdf ? 'Öppna mejlutkast med bilaga' : 'Öppna mejlutkast'));
            actions.append($('<button type="button">').addClass('btn btn-secondary').text('Kopiera kundsvaret').on('click', async function () {
                try { await navigator.clipboard.writeText(email.body); $(this).text('Kopierat'); }
                catch (_) { progress.text('Kunde inte kopiera. Markera texten i svaret.'); }
            }));
            output.append(actions, $('<p>').addClass('quote-agent-muted').text('Öppna .eml-filen i Outlook som ett oskickat mejl. Niclas väljer själv om och när det skickas.'));
        }
        if (data.has_pdf) {
            const pdfHeading = quoteHeading;
            const pdfArea = $('<div>').text('Läser offertbilagan…');
            output.append(pdfHeading, pdfArea);
            try {
                const response = await adminFetch(endpoint + '/pdf/preview');
                if (!response.ok) throw new Error('Bilagan kunde inte läsas');
                const blob = await response.blob();
                if (closed) return;
                pdfUrl = URL.createObjectURL(blob);
                const download = $('<button type="button">').addClass('btn btn-secondary').text('Ladda ner offert-PDF').on('click', async function () {
                    try {
                        const response = await adminFetch(endpoint + '/pdf');
                        if (!response.ok) throw new Error('PDF kunde inte hämtas');
                        const url = URL.createObjectURL(await response.blob());
                        const link = document.createElement('a'); link.href = url; link.download = 'Offertutkast.pdf'; link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 10000);
                    } catch (error) { progress.text(error.message); }
                });
                pdfArea.empty().append(download, $('<img>').addClass('quote-agent-pdf').attr({src: pdfUrl, alt: 'Offertutkast i Niclas originalmall'}));
            } catch (error) { pdfArea.text(error.message); }
        }
        output.append($('<p>').addClass('quote-agent-muted').text(`${result.model || data.model} · high · ${result.created_at ? new Date(result.created_at).toLocaleString('sv-SE') : ''}`));
    }
    async function load() {
        if (closed || !panel[0].isConnected) return;
        try { await display(await requestJson(endpoint)); }
        catch (error) { setBusy(false); progress.text(error.message); }
    }
    async function start() {
        if (running) return;
        setBusy(true);
        try { await display(await requestJson(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({regenerate: true})})); }
        catch (error) { setBusy(false); progress.text(error.message); }
    }
    async function loadMemories() {
        try {
            const data = await requestJson(`${API_BASE}/api/quote_agent/feedback`);
            memoryList.empty();
            if (!data.memories.length) memoryList.append($('<p>').text('Inga minnen sparade ännu.'));
            data.memories.slice().reverse().forEach(memory => {
                const row = $('<div>').addClass('quote-agent-memory');
                const label = memory.scope === 'model' ? `${memory.boat.manufacturer || ''} ${memory.boat.model || ''}`.trim() : 'Generellt';
                const remove = $('<button type="button">').addClass('btn btn-secondary').text('Ta bort').on('click', async function () {
                    $(this).prop('disabled', true);
                    try { await requestJson(`${API_BASE}/api/quote_agent/feedback/${encodeURIComponent(memory.id)}`, {method: 'DELETE'}); await loadMemories(); }
                    catch (error) { feedbackStatus.text(error.message); $(this).prop('disabled', false); }
                });
                row.append($('<small>').text(`${label} · ${new Date(memory.created_at + 'Z').toLocaleDateString('sv-SE')}`), $('<p>').text(memory.text), remove);
                memoryList.append(row);
            });
        } catch (error) { feedbackStatus.text(error.message); }
    }
    async function saveFeedback(rerun) {
        const text = feedbackInput.val().trim();
        if (!text) { feedbackStatus.text('Skriv vad agenten ska ändra eller komma ihåg.'); feedbackInput.trigger('focus'); return; }
        save.prop('disabled', true); saveAndRun.prop('disabled', true);
        try {
            await requestJson(`${API_BASE}/api/quote_agent/feedback`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({submission_id: id, text, scope: scope.val()})});
            feedbackInput.val(''); feedbackStatus.text('Minnet är sparat och läses vid varje körning.');
            await loadMemories();
            if (rerun) await start();
        } catch (error) { feedbackStatus.text(error.message); }
        finally { save.prop('disabled', false); saveAndRun.prop('disabled', running); }
    }
    runButton.on('click', start);
    save.on('click', () => saveFeedback(false));
    saveAndRun.on('click', () => saveFeedback(true));
    container.data('quoteAgentCleanup', () => { closed = true; if (timer) clearTimeout(timer); if (pdfUrl) URL.revokeObjectURL(pdfUrl); });
    load(); loadMemories();
}
