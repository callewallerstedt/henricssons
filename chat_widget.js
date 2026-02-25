(function () {
    const STORAGE_KEY = 'henricssons_chat_state_v5';
    const MAX_HISTORY = 40;
    const FENDER_GUIDE_URL = 'https://cdn.prod.website-files.com/5e669fea091655b193e71a3b/5e7c6246ee55b0062a529478_LIROS-Fenderskyddstorleksguide.pdf';
    const FENDER_GUIDE_TEXT_SV = 'Läs mer om Liros fenderskydd och storleksguide här';
    const FENDER_GUIDE_TEXT_EN = 'Read more about Liros fender protection and size guide here';
    const FENDER_SIZE_OPTIONS = [
        'F1 6x25"',
        'F2 8x27"',
        'F3 9x30"',
        'F4 9x41"',
        'F5 12x30"',
        'F6 12x43"'
    ];
    const API_BASE_CANDIDATES = buildApiBaseCandidates();
    const GREETING_SV = 'Hej! Hur kan vi hjälpa dig?';
    const GREETING_EN = 'Hello! How can we help you?';
    const QUICK_ACTION_KEYS = ['Kapellforfragan', 'Fenderforfragan', 'Kontakt'];
    const SUMMARY_FIELD_ORDER = [
        'name',
        'email',
        'phone',
        'address',
        'postal_code',
        'city',
        'boat_brand',
        'boat_model',
        'boat_year',
        'home_port',
        'wants_cover',
        'wants_fender_socks',
        'size',
        'quantity',
        'subject',
        'message'
    ];
    const SUMMARY_FIELD_LABELS = {
        name: { sv: 'Namn', en: 'Name' },
        email: { sv: 'E-post', en: 'Email' },
        phone: { sv: 'Telefonnummer', en: 'Phone number' },
        address: { sv: 'Adress', en: 'Address' },
        postal_code: { sv: 'Postnummer', en: 'Postal code' },
        city: { sv: 'Ort', en: 'City' },
        boat_brand: { sv: 'Båtmärke', en: 'Boat brand' },
        boat_model: { sv: 'Båtmodell', en: 'Boat model' },
        boat_year: { sv: 'Årsmodell', en: 'Year model' },
        home_port: { sv: 'Hemmahamn', en: 'Home port' },
        wants_cover: { sv: 'Önskar kapell', en: 'Wants boat cover' },
        wants_fender_socks: { sv: 'Önskar fenderstrumpor', en: 'Wants fender socks' },
        size: { sv: 'Storlek', en: 'Size' },
        quantity: { sv: 'Antal', en: 'Quantity' },
        subject: { sv: 'Ämne', en: 'Subject' },
        message: { sv: 'Meddelande', en: 'Message' }
    };

    function buildApiBaseCandidates() {
        const candidates = [];
        const seen = {};
        function addCandidate(value) {
            const normalized = String(value || '').trim().replace(/\/+$/, '');
            if (!normalized || seen[normalized]) return;
            try {
                new URL(normalized);
                seen[normalized] = true;
                candidates.push(normalized);
            } catch (_) {
                // Ignore invalid candidate.
            }
        }

        addCandidate(`${location.protocol}//${location.host}`);
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
            addCandidate(`${location.protocol}//${location.hostname}:25565`);
        }
        addCandidate('https://henricssons-api.onrender.com');
        return candidates;
    }

    function buildEndpoint(base, path) {
        return new URL(path, `${base}/`).toString();
    }

    async function postJsonWithFallback(path, body) {
        let lastError = null;
        for (const base of API_BASE_CANDIDATES) {
            try {
                const endpoint = buildEndpoint(base, path);
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.error || `HTTP ${response.status}`);
                }
                return data;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('No API endpoint available');
    }

    const defaultState = {
        intent: '',
        draft: {},
        readyToSubmit: false,
        needsConfirmation: false,
        confirmed: false,
        language: 'sv',
        summary: '',
        isTyping: false,
        isSubmitting: false,
        history: [{ role: 'assistant', content: GREETING_SV }]
    };

    let state = loadState();

    function normalizeGreetingText(text, language) {
        const value = String(text || '').trim();
        const svVariants = new Set([
            'Hej! Vad soker du hjalp med idag?',
            'Hej! Vad söker du hjälp med idag?',
            'Hej! Hur kan vi hjalpa dig?',
            'Hej! Hur kan vi hjälpa dig?',
            GREETING_SV
        ]);
        const enVariants = new Set([
            'Hello! What are you looking for help with today?',
            GREETING_EN
        ]);
        if (svVariants.has(value)) return GREETING_SV;
        if (enVariants.has(value)) return GREETING_EN;
        return value || (language === 'en' ? GREETING_EN : GREETING_SV);
    }

    function normalizePersistedHistory(history, language) {
        const greeting = language === 'en' ? GREETING_EN : GREETING_SV;
        if (!Array.isArray(history) || !history.length) {
            return [{ role: 'assistant', content: greeting }];
        }
        const items = history.slice(-MAX_HISTORY);
        const first = items[0];
        if (first && String(first.role || '').toLowerCase() === 'assistant') {
            items[0] = {
                ...first,
                content: greeting
            };
            return items;
        }
        return [{ role: 'assistant', content: greeting }, ...items].slice(-MAX_HISTORY);
    }

    function loadState() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (_) {
            // Ignore storage errors.
        }
        return {
            ...defaultState,
            history: [{ role: 'assistant', content: GREETING_SV }]
        };
    }

    function saveState() {
        // Chat should reset on full page refresh; do not persist state.
    }

    function t(sv, en) {
        return state.language === 'en' ? en : sv;
    }

    function humanizeFieldKey(key) {
        return String(key || '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function getSummaryFieldLabel(key) {
        const mapped = SUMMARY_FIELD_LABELS[key];
        if (mapped) return t(mapped.sv, mapped.en);
        return humanizeFieldKey(key);
    }

    function formatSummaryValue(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return t(value ? 'Ja' : 'Nej', value ? 'Yes' : 'No');
        if (Array.isArray(value)) {
            const parts = value
                .map((item) => formatSummaryValue(item))
                .filter(Boolean);
            return parts.join(', ');
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (_) {
                return '';
            }
        }
        return String(value).trim();
    }

    function buildSummaryRows() {
        const draft = state.draft && typeof state.draft === 'object' ? state.draft : {};
        const rows = [];
        const usedKeys = {};

        SUMMARY_FIELD_ORDER.forEach((key) => {
            const formattedValue = formatSummaryValue(draft[key]);
            if (!formattedValue) return;
            usedKeys[key] = true;
            rows.push({
                label: getSummaryFieldLabel(key),
                value: formattedValue
            });
        });

        Object.keys(draft).forEach((key) => {
            if (usedKeys[key]) return;
            const formattedValue = formatSummaryValue(draft[key]);
            if (!formattedValue) return;
            rows.push({
                label: getSummaryFieldLabel(key),
                value: formattedValue
            });
        });

        return rows;
    }

    function renderSummaryPanel(ui) {
        const summaryEl = ui.summary;
        const summaryTextEl = ui.summaryText;
        const summaryText = String(state.summary || '').trim();
        const summaryRows = buildSummaryRows();
        const shouldShow = Boolean(state.readyToSubmit || state.needsConfirmation || summaryText);
        if (!shouldShow) {
            summaryEl.style.display = 'none';
            summaryTextEl.textContent = '';
            return;
        }

        summaryEl.style.display = 'block';
        summaryTextEl.innerHTML = '';

        const heading = document.createElement('div');
        heading.id = 'hen-chat-summary-heading';
        heading.textContent = t('Sammanfattning', 'Summary');
        summaryTextEl.appendChild(heading);

        if (summaryRows.length) {
            const list = document.createElement('ul');
            list.id = 'hen-chat-summary-list';
            summaryRows.forEach((row) => {
                const item = document.createElement('li');
                item.textContent = `${row.label}: ${row.value}`;
                list.appendChild(item);
            });
            summaryTextEl.appendChild(list);
            return;
        }

        const body = document.createElement('div');
        body.id = 'hen-chat-summary-empty';
        body.style.whiteSpace = 'pre-wrap';
        body.textContent = summaryText || t('Väntar på sammanfattning från assistenten.', 'Waiting for summary from assistant.');
        summaryTextEl.appendChild(body);
    }

    function getQuickActionLabel(actionKey) {
        if (actionKey === 'Kapellforfragan') return t('Kapell', 'Canopy');
        if (actionKey === 'Fenderforfragan') return t('Fenderstrumpor', 'Fender socks');
        return t('Kontakt', 'Contact');
    }

    function buildQuickActionPrompt(actionKey) {
        if (actionKey === 'Kapellforfragan') {
            return t(
                'Jag vill göra en kapellförfrågan. Bekräfta kort att du hjälper mig med kapell och ställ första relevanta frågan.',
                'I want to start a boat cover inquiry. Confirm briefly that you can help and ask the first relevant question.'
            );
        }
        if (actionKey === 'Fenderforfragan') {
            return t(
                'Jag vill göra en fenderförfrågan. Bekräfta kort att du hjälper mig med fenderstrumpor och ställ första relevanta frågan.',
                'I want to start a fender inquiry. Confirm briefly that you can help with fender socks and ask the first relevant question.'
            );
        }
        return t(
            'Jag vill skicka ett kontaktmeddelande. Bekräfta kort att du hjälper mig och fråga efter första relevanta uppgift.',
            'I want to send a contact message. Confirm briefly that you can help and ask for the first relevant detail.'
        );
    }

    function renderQuickActions(ui) {
        if (!ui || !ui.quickActionBtns || !ui.quickActionBtns.length) return;
        const disabled = Boolean(state.isTyping || state.isSubmitting);
        ui.quickActionBtns.forEach((button) => {
            const actionKey = String(button.dataset.action || '');
            button.textContent = getQuickActionLabel(actionKey);
            button.disabled = disabled;
        });
    }

    function createWidget() {
        const root = document.createElement('div');
        root.id = 'hen-chat-widget';

        const style = document.createElement('style');
        style.textContent = `
#hen-chat-widget { position: fixed; right: 18px; bottom: 18px; z-index: 9999; font-family: "Manrope", "Avenir Next", "Segoe UI", sans-serif; }
#hen-chat-toggle { position: relative; z-index: 5; width: 58px; height: 58px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: linear-gradient(145deg, #0e4f8f 0%, #0a2342 65%); color: #fff; font-weight: 700; cursor: pointer; box-shadow: 0 14px 28px rgba(10, 35, 66, .38); display: flex; align-items: center; justify-content: center; transition: transform .15s ease, box-shadow .2s ease; }
#hen-chat-toggle:hover { transform: translateY(-1px); box-shadow: 0 18px 30px rgba(10, 35, 66, .46); }
#hen-chat-panel { position: relative; z-index: 4; width: min(390px, calc(100vw - 30px)); height: min(565px, calc(100vh - 90px)); background: linear-gradient(180deg, #fcfdff 0%, #f6f9ff 100%); border: 1px solid #cdd8e8; border-radius: 18px; box-shadow: 0 26px 54px rgba(8, 22, 44, .26); display: none; flex-direction: column; margin-bottom: 10px; overflow: hidden; }
#hen-chat-panel.open { display: flex; }
#hen-chat-teaser { position: absolute; z-index: 2; right: 0; bottom: 0; width: min(300px, calc(50vw - 96px)); max-width: min(300px, calc(100vw - 96px)); height: 54px; min-height: 54px; display: flex; align-items: center; background: #ffffff; color: #0a2342; border: 1px solid #d9e3ee; border-radius: 999px; padding: 0 64px 0 16px; font-size: 0.98rem; font-weight: 400; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 8px 20px rgba(0,0,0,.15); opacity: 0; transform: translateX(16px) translateY(2px); pointer-events: none; transition: opacity 0.26s ease, transform 0.26s ease; cursor: pointer; }
#hen-chat-teaser::after { display: none; }
#hen-chat-teaser.show { opacity: 1; transform: translateX(0) translateY(0); pointer-events: auto; }
#hen-chat-panel.open ~ #hen-chat-teaser { display: none; }
#hen-chat-panel.open ~ #hen-chat-toggle { display: none; }
#hen-chat-header { background: linear-gradient(120deg, #0a2342 0%, #114a81 100%); color: #fff; padding: 11px 13px; display: flex; justify-content: space-between; align-items: center; }
#hen-chat-title { font-size: 0.95rem; font-weight: 700; }
#hen-chat-header-actions { display: inline-flex; align-items: center; gap: 6px; }
#hen-chat-close, #hen-chat-reset-top { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 0; color: #fff; border-radius: 999px; cursor: pointer; }
#hen-chat-close { font-size: 1.1rem; }
#hen-chat-reset-top svg { width: 16px; height: 16px; }
#hen-chat-close:hover, #hen-chat-reset-top:hover { background: rgba(255,255,255,0.14); }
#hen-chat-messages { flex: 1; overflow-y: auto; padding: 12px; background: radial-gradient(circle at top right, #ffffff 0%, #f2f7ff 50%, #edf4ff 100%); display: flex; flex-direction: column; gap: 10px; }
.hen-msg { max-width: 88%; padding: 9px 12px; border-radius: 14px; white-space: pre-wrap; line-height: 1.45; font-size: 0.92rem; box-shadow: 0 4px 12px rgba(12, 38, 71, .08); }
.hen-msg.user { align-self: flex-end; background: linear-gradient(140deg, #d8eeff 0%, #c8e6ff 100%); color: #0b2f4b; border: 1px solid #b7d6f3; border-bottom-right-radius: 6px; }
.hen-msg.assistant { align-self: flex-start; background: #ffffff; color: #0a2342; border: 1px solid #d5deec; border-bottom-left-radius: 6px; }
.hen-msg.typing { display: inline-flex; align-items: center; gap: 4px; min-width: 48px; }
.hen-dot { width: 7px; height: 7px; border-radius: 999px; background: #5f7388; opacity: 0.35; animation: henPulse 1.2s infinite ease-in-out; }
.hen-dot:nth-child(2) { animation-delay: 0.2s; }
.hen-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes henPulse { 0%, 80%, 100% { opacity: 0.35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
#hen-chat-summary { display: none; margin: 0 10px 8px 10px; padding: 10px; border: 1px solid #bfd0e6; border-radius: 12px; background: linear-gradient(180deg, #f2f7ff 0%, #eaf2ff 100%); font-size: .85rem; white-space: normal; }
#hen-chat-summary-text { margin-bottom: 8px; color: #0a2342; }
#hen-chat-summary-heading { font-weight: 700; margin-bottom: 6px; }
#hen-chat-summary-list { margin: 0; padding-left: 18px; color: #0a2342; }
#hen-chat-summary-list li { margin: 0 0 4px 0; }
#hen-chat-summary-empty { color: #27476f; }
#hen-chat-summary-submit { display: none; border: 0; background: linear-gradient(120deg, #13853b 0%, #0e7a2f 100%); color: #fff; padding: 9px 12px; font-weight: 700; cursor: pointer; border-radius: 9px; width: 100%; }
#hen-chat-summary-submit[disabled] { opacity: 0.75; cursor: wait; }
#hen-chat-fender-tools { display: none; margin: 0 10px 8px 10px; padding: 10px; border: 1px solid #cdd9ea; border-radius: 12px; background: #f8fbff; }
#hen-chat-fender-guide-link { display: inline-block; margin-bottom: 8px; font-size: 0.84rem; color: #0b5fc2; text-decoration: underline; }
#hen-chat-fender-size { width: 100%; border: 1px solid #cdd4de; border-radius: 8px; padding: 8px; font-size: 0.9rem; color: #0a2342; background: #fff; }
#hen-chat-fender-note { margin-top: 6px; font-size: 0.78rem; color: #34527a; min-height: 1.1em; }
#hen-chat-actions { padding: 9px 10px; border-top: 1px solid #d7dfeb; background: linear-gradient(180deg, #ffffff 0%, #f7faff 100%); }
#hen-chat-quick-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px 0; }
.hen-chat-pill { border: 1px solid #bed0e5; background: #fff; color: #0a2342; border-radius: 999px; padding: 6px 11px; font-size: 0.8rem; line-height: 1; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.hen-chat-pill:hover { background: #ebf3ff; border-color: #9ab8d8; color: #08325d; }
.hen-chat-pill:disabled { opacity: .6; cursor: wait; }
#hen-chat-input-row { display: flex; gap: 6px; align-items: flex-end; }
#hen-chat-input { flex: 1; border: 1px solid #c4d2e4; border-radius: 10px; padding: 9px; font-size: .9rem; font-family: inherit; line-height: 1.35; min-height: 40px; max-height: 120px; resize: none; overflow-y: auto; background: #fff; }
#hen-chat-input:focus { outline: none; border-color: #2f78bf; box-shadow: 0 0 0 3px rgba(47,120,191,.18); }
#hen-chat-send { border: 0; background: linear-gradient(130deg, #0f4e8b 0%, #0a2342 100%); color: #fff; padding: 9px 12px; cursor: pointer; border-radius: 10px; font-weight: 700; }
.hen-msg a { color: #0b5fc2; text-decoration: underline; }
.hen-msg a:hover { color: #094891; }
@media (max-width: 680px) {
  #hen-chat-widget {
    right: 10px;
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
  #hen-chat-toggle {
    z-index: 5;
    width: 54px;
    height: 54px;
    box-shadow: 0 8px 18px rgba(0,0,0,.3);
  }
  #hen-chat-teaser {
    right: 0;
    bottom: 0;
    width: min(250px, calc(100vw - 88px));
    max-width: min(250px, calc(100vw - 88px));
    height: 54px;
    min-height: 54px;
    font-size: 0.92rem;
    font-weight: 400;
    padding: 0 54px 0 14px;
  }
  #hen-chat-panel {
    width: calc(100vw - 20px);
    height: min(68vh, 520px);
    height: min(68dvh, 520px);
    max-height: calc(100vh - 20px - env(safe-area-inset-bottom, 0px));
    max-height: calc(100dvh - 20px - env(safe-area-inset-bottom, 0px));
    margin-bottom: 0;
    border-radius: 12px;
    overflow: hidden;
  }
  #hen-chat-header {
    padding: 10px 10px;
  }
  #hen-chat-title {
    font-size: 0.92rem;
  }
  #hen-chat-messages {
    padding: 8px;
    gap: 7px;
  }
  .hen-msg {
    max-width: 94%;
    padding: 7px 9px;
    font-size: 0.88rem;
  }
  #hen-chat-summary {
    margin: 0 8px 7px 8px;
    padding: 7px;
    font-size: 0.8rem;
  }
  #hen-chat-fender-tools {
    margin: 0 8px 7px 8px;
    padding: 8px;
  }
  #hen-chat-fender-guide-link {
    font-size: 0.8rem;
    margin-bottom: 7px;
  }
  #hen-chat-fender-size {
    font-size: 16px;
    padding: 9px;
  }
  #hen-chat-fender-note {
    font-size: 0.76rem;
  }
  #hen-chat-actions {
    padding: 7px 8px;
  }
  #hen-chat-quick-actions {
    gap: 5px;
    margin: 0 0 7px 0;
  }
  .hen-chat-pill {
    padding: 6px 10px;
    font-size: 0.78rem;
  }
  #hen-chat-input {
    font-size: 16px;
    padding: 9px;
    min-height: 42px;
    max-height: 132px;
  }
  #hen-chat-send {
    padding: 9px 10px;
    min-width: 78px;
  }
}
`;

        const panel = document.createElement('div');
        panel.id = 'hen-chat-panel';
        panel.innerHTML = `
<div id="hen-chat-header">
  <div id="hen-chat-title">Henricssons AI</div>
  <div id="hen-chat-header-actions">
    <button id="hen-chat-reset-top" aria-label="Rensa chatten" title="Rensa chatten"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 5a7 7 0 1 1-6.18 3.71H3l3.5-3.5L10 8.71H7.91A5 5 0 1 0 12 7V5z"/></svg></button>
    <button id="hen-chat-close" aria-label="Stäng">x</button>
  </div>
</div>
<div id="hen-chat-messages"></div>
<div id="hen-chat-summary">
  <div id="hen-chat-summary-text"></div>
  <button id="hen-chat-summary-submit">Skicka</button>
</div>
<div id="hen-chat-fender-tools">
  <a id="hen-chat-fender-guide-link" href="${FENDER_GUIDE_URL}" target="_blank" rel="noopener noreferrer">${FENDER_GUIDE_TEXT_SV}</a>
  <select id="hen-chat-fender-size">
    <option value="">Välj storlek...</option>
  </select>
  <div id="hen-chat-fender-note"></div>
</div>
<div id="hen-chat-actions">
  <div id="hen-chat-quick-actions">
    <button class="hen-chat-pill" data-action="Kapellforfragan" type="button">Kapell</button>
    <button class="hen-chat-pill" data-action="Fenderforfragan" type="button">Fenderstrumpor</button>
    <button class="hen-chat-pill" data-action="Kontakt" type="button">Kontakt</button>
  </div>
  <div id="hen-chat-input-row">
    <textarea id="hen-chat-input" rows="1" placeholder="Skriv ditt meddelande..."></textarea>
    <button id="hen-chat-send">Skicka</button>
  </div>
</div>`;

        const toggle = document.createElement('button');
        toggle.id = 'hen-chat-toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-label', 'Open chat');
        toggle.title = 'Open chat';
        toggle.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4h12v2H6V8zm0 4h9v2H6v-2z"/></svg>';

        const teaser = document.createElement('div');
        teaser.id = 'hen-chat-teaser';
        teaser.setAttribute('role', 'button');
        teaser.setAttribute('tabindex', '0');
        teaser.textContent = state.language === 'en' ? GREETING_EN : GREETING_SV;

        root.appendChild(style);
        root.appendChild(panel);
        root.appendChild(teaser);
        root.appendChild(toggle);
        document.body.appendChild(root);
        return { panel, toggle, teaser };
    }

    function appendMessage(container, role, content) {
        const msg = document.createElement('div');
        msg.className = `hen-msg ${role}`;
        renderMessageText(msg, content);
        container.appendChild(msg);
    }

    function renderMessageText(container, content) {
        const text = String(content || '');
        const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
        let cursor = 0;
        let match = pattern.exec(text);
        while (match) {
            if (match.index > cursor) {
                container.appendChild(document.createTextNode(text.slice(cursor, match.index)));
            }
            const anchor = document.createElement('a');
            const href = match[2] || match[3];
            anchor.href = href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = match[1] || href;
            container.appendChild(anchor);
            cursor = pattern.lastIndex;
            match = pattern.exec(text);
        }
        if (cursor < text.length) {
            container.appendChild(document.createTextNode(text.slice(cursor)));
        }
    }

    function appendTypingBubble(container) {
        const bubble = document.createElement('div');
        bubble.className = 'hen-msg assistant typing';
        for (let i = 0; i < 3; i += 1) {
            const dot = document.createElement('span');
            dot.className = 'hen-dot';
            bubble.appendChild(dot);
        }
        container.appendChild(bubble);
    }

    let pendingFenderSize = '';

    function isFenderFlowActive() {
        if (state.intent === 'Fenderforfragan') return true;
        const draft = state.draft || {};
        return Boolean(draft.quantity || draft.size || draft.address);
    }

    function renderFenderTools(ui) {
        if (!ui || !ui.fenderTools || !ui.fenderSizeSelect || !ui.fenderGuideLink || !ui.fenderNote) return;
        const active = isFenderFlowActive();
        if (!active) {
            pendingFenderSize = '';
            ui.fenderTools.style.display = 'none';
            ui.fenderNote.textContent = '';
            ui.fenderSizeSelect.value = '';
            return;
        }
        ui.fenderTools.style.display = 'block';
        ui.fenderGuideLink.textContent = state.language === 'en' ? FENDER_GUIDE_TEXT_EN : FENDER_GUIDE_TEXT_SV;
        const draftSize = String((state.draft && state.draft.size) || '').trim();
        ui.fenderSizeSelect.value = pendingFenderSize || draftSize || '';
        if (pendingFenderSize) {
            ui.fenderNote.textContent = state.language === 'en'
                ? 'Size will be sent automatically with your next message.'
                : 'Storlek skickas automatiskt med ditt nästa meddelande.';
        } else {
            ui.fenderNote.textContent = '';
        }
    }

    function buildOutgoingMessage(trimmedText) {
        const text = String(trimmedText || '').trim();
        if (!text) return text;
        const selectedSize = String(pendingFenderSize || '').trim();
        if (!selectedSize) return text;
        if (String((state.draft && state.draft.size) || '').trim()) {
            pendingFenderSize = '';
            return text;
        }
        if (/\b(storlek|size)\b/i.test(text)) {
            pendingFenderSize = '';
            return text;
        }
        pendingFenderSize = '';
        return `${text}\nStorlek: ${selectedSize}`;
    }

    function renderMessages(ui) {
        const container = ui.messages;
        const summarySubmitBtn = ui.summarySubmitBtn;

        container.innerHTML = '';
        state.history.forEach((item) => {
            if (!item || !item.role || !item.content) return;
            appendMessage(container, item.role === 'user' ? 'user' : 'assistant', String(item.content));
        });

        if (state.isTyping) {
            appendTypingBubble(container);
        }

        renderSummaryPanel(ui);
        renderFenderTools(ui);
        renderQuickActions(ui);

        if (state.readyToSubmit) {
            summarySubmitBtn.style.display = 'block';
            summarySubmitBtn.disabled = state.isSubmitting;
            summarySubmitBtn.textContent = state.isSubmitting
                ? t('Skickar...', 'Sending...')
                : t('Skicka', 'Send');
        } else {
            summarySubmitBtn.style.display = 'none';
            summarySubmitBtn.disabled = false;
            summarySubmitBtn.textContent = t('Skicka', 'Send');
        }

        container.scrollTop = container.scrollHeight;
    }

    async function sendMessage(message, ui, options) {
        const opts = options || {};
        const showUserMessage = opts.showUserMessage !== false;
        const preserveInput = Boolean(opts.preserveInput);
        const trimmed = String(message || '').trim();
        if (!trimmed) return;
        const outgoingMessage = buildOutgoingMessage(trimmed);

        state.confirmed = false;
        state.isTyping = true;
        if (showUserMessage) {
            state.history.push({ role: 'user', content: trimmed });
            state.history = state.history.slice(-MAX_HISTORY);
        }
        saveState();
        renderMessages(ui);

        ui.sendBtn.disabled = true;
        ui.input.disabled = true;

        try {
            const data = await postJsonWithFallback('/api/assistant_chat', {
                message: outgoingMessage,
                history: state.history,
                draft: state.draft,
                intent: state.intent,
                confirmed: state.confirmed,
                language: state.language
            });

            state.intent = typeof data.intent === 'string' ? data.intent : state.intent;
            state.draft = data.draft || state.draft;
            state.readyToSubmit = Boolean(data.ready_to_submit);
            state.needsConfirmation = Boolean(data.needs_confirmation);
            state.confirmed = Boolean(data.confirmed);
            state.language = data.language || state.language;
            state.summary = data.summary || '';
            if (String(data.reply || '').trim()) {
                state.history.push({
                    role: 'assistant',
                    content: String(data.reply)
                });
            }
            state.history = state.history.slice(-MAX_HISTORY);
            saveState();
        } catch (err) {
            state.history.push({
                role: 'assistant',
                content: t(`Jag kunde inte svara just nu: ${err.message}`, `I could not answer right now: ${err.message}`)
            });
            state.history = state.history.slice(-MAX_HISTORY);
            saveState();
        } finally {
            state.isTyping = false;
            ui.sendBtn.disabled = false;
            ui.input.disabled = false;
            if (!preserveInput) {
                ui.input.value = '';
            }
            autoResizeInput(ui.input);
            if (shouldAutoFocusInput()) {
                ui.input.focus({ preventScroll: true });
            }
            renderMessages(ui);
        }
    }

    async function triggerQuickAction(actionKey, ui) {
        if (!QUICK_ACTION_KEYS.includes(actionKey)) return;
        if (state.isTyping || state.isSubmitting) return;
        const prompt = buildQuickActionPrompt(actionKey);
        await sendMessage(prompt, ui, { showUserMessage: false, preserveInput: true });
    }

    async function submitFromChat(ui) {
        if (state.isSubmitting || !state.readyToSubmit) return;
        state.isSubmitting = true;
        renderMessages(ui);
        try {
            const data = await postJsonWithFallback('/api/assistant_submit', {
                intent: state.intent,
                draft: state.draft,
                confirmed: true
            });
            if (Array.isArray(data.missing_fields) && data.missing_fields.length) {
                throw new Error(t(
                    `Saknade fält: ${data.missing_fields.join(', ')}`,
                    `Missing fields: ${data.missing_fields.join(', ')}`
                ));
            }

            state.history.push({
                role: 'assistant',
                content: t(
                    'Tack! Din förfrågan är skickad. Vi återkommer så snart som möjligt.',
                    'Thanks! Your request has been sent. We will get back to you as soon as possible.'
                )
            });
            state.history = state.history.slice(-MAX_HISTORY);
            state.readyToSubmit = false;
            state.needsConfirmation = false;
            state.confirmed = false;
            state.summary = '';
            state.draft = {};
            saveState();
        } catch (err) {
            state.history.push({
                role: 'assistant',
                content: t(`Kunde inte skicka: ${err.message}`, `Could not send: ${err.message}`)
            });
            state.history = state.history.slice(-MAX_HISTORY);
            saveState();
        } finally {
            state.isSubmitting = false;
            renderMessages(ui);
        }
    }

    function resetChat(ui) {
        pendingFenderSize = '';
        state = {
            ...defaultState,
            history: [{ role: 'assistant', content: t(GREETING_SV, GREETING_EN) }]
        };
        saveState();
        renderMessages(ui);
    }

    function shouldAutoFocusInput() {
        const hasMatchMedia = typeof window.matchMedia === 'function';
        const isCoarsePointer = hasMatchMedia && window.matchMedia('(pointer: coarse)').matches;
        const isNarrowViewport = window.innerWidth <= 680;
        return !(isCoarsePointer || isNarrowViewport);
    }

    function autoResizeInput(inputEl) {
        if (!inputEl) return;
        inputEl.style.height = 'auto';
        const nextHeight = Math.min(inputEl.scrollHeight, 132);
        inputEl.style.height = `${Math.max(nextHeight, 40)}px`;
    }

    function setPanelOpen(ui, isOpen) {
        ui.panel.classList.toggle('open', Boolean(isOpen));
        if (isOpen) {
            hideTeaser(ui);
        }
        if (isOpen && shouldAutoFocusInput()) {
            requestAnimationFrame(() => {
                ui.input.focus({ preventScroll: true });
            });
        }
    }

    let teaserTimerId = null;
    let teaserHideTimerId = null;
    let teaserDisplayed = false;

    function hideTeaser(ui) {
        if (!ui || !ui.teaser) return;
        if (teaserHideTimerId) {
            clearTimeout(teaserHideTimerId);
            teaserHideTimerId = null;
        }
        ui.teaser.classList.remove('show');
    }

    function scheduleTeaser(ui) {
        if (!ui || !ui.teaser || teaserDisplayed) return;
        if (teaserTimerId) {
            clearTimeout(teaserTimerId);
            teaserTimerId = null;
        }
        ui.teaser.textContent = state.language === 'en' ? GREETING_EN : GREETING_SV;
        teaserTimerId = setTimeout(() => {
            if (!ui.panel.classList.contains('open')) {
                ui.teaser.classList.add('show');
                teaserDisplayed = true;
                teaserHideTimerId = setTimeout(() => {
                    hideTeaser(ui);
                }, 3000);
            }
        }, 1000);
    }

    function init() {
        const { panel, toggle, teaser } = createWidget();
        const ui = {
            panel,
            toggle,
            teaser,
            closeBtn: panel.querySelector('#hen-chat-close'),
            resetBtn: panel.querySelector('#hen-chat-reset-top'),
            messages: panel.querySelector('#hen-chat-messages'),
            summary: panel.querySelector('#hen-chat-summary'),
            summaryText: panel.querySelector('#hen-chat-summary-text'),
            summarySubmitBtn: panel.querySelector('#hen-chat-summary-submit'),
            fenderTools: panel.querySelector('#hen-chat-fender-tools'),
            fenderGuideLink: panel.querySelector('#hen-chat-fender-guide-link'),
            fenderSizeSelect: panel.querySelector('#hen-chat-fender-size'),
            fenderNote: panel.querySelector('#hen-chat-fender-note'),
            quickActionBtns: Array.from(panel.querySelectorAll('.hen-chat-pill')),
            input: panel.querySelector('#hen-chat-input'),
            sendBtn: panel.querySelector('#hen-chat-send')
        };

        FENDER_SIZE_OPTIONS.forEach((sizeOption) => {
            const option = document.createElement('option');
            option.value = sizeOption;
            option.textContent = sizeOption;
            ui.fenderSizeSelect.appendChild(option);
        });

        renderMessages(ui);
        scheduleTeaser(ui);
        autoResizeInput(ui.input);

        ui.toggle.addEventListener('click', () => {
            const isOpen = !ui.panel.classList.contains('open');
            setPanelOpen(ui, isOpen);
        });

        ui.closeBtn.addEventListener('click', () => {
            setPanelOpen(ui, false);
        });

        ui.teaser.addEventListener('click', () => {
            setPanelOpen(ui, true);
        });

        ui.teaser.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setPanelOpen(ui, true);
            }
        });

        ui.fenderSizeSelect.addEventListener('change', () => {
            pendingFenderSize = String(ui.fenderSizeSelect.value || '').trim();
            renderFenderTools(ui);
        });

        ui.sendBtn.addEventListener('click', () => sendMessage(ui.input.value, ui));
        ui.quickActionBtns.forEach((button) => {
            button.addEventListener('click', () => {
                triggerQuickAction(String(button.dataset.action || ''), ui);
            });
        });
        ui.input.addEventListener('input', () => autoResizeInput(ui.input));
        ui.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                sendMessage(ui.input.value, ui);
            }
        });

        ui.summarySubmitBtn.addEventListener('click', () => submitFromChat(ui));
        ui.resetBtn.addEventListener('click', () => resetChat(ui));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();


