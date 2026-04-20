(function () {
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
    const GREETING_SV = 'Hej! Vad kan vi hjälpa dig med?';
    const GREETING_EN = 'Hello! Tell me what you need, and I will point you in the right direction.';
    const ACTION_KEYS = ['Kapellforfragan', 'Fenderforfragan', 'Kontakt'];
    const ROUTE_CONFIG = {
        Kapellforfragan: {
            href: '/kapellforfragan#contact-form',
            short: { sv: 'Kapell', en: 'Canopy' },
            button: { sv: 'Gör en kapellförfrågan', en: 'Open canopy inquiry' },
            recommendation: {
                sv: 'Det här passar bäst som en kapellförfrågan.',
                en: 'This is best handled as a canopy inquiry.'
            }
        },
        Fenderforfragan: {
            href: '/tillbehor#fenderForm',
            short: { sv: 'Fender', en: 'Fender' },
            button: { sv: 'Gör en fenderförfrågan', en: 'Open fender inquiry' },
            recommendation: {
                sv: 'Det här passar bäst under fenderstrumpor.',
                en: 'This is best handled through the fender socks page.'
            }
        },
        Kontakt: {
            href: '/kontakt#contactForm',
            short: { sv: 'Kontakt', en: 'Contact' },
            button: { sv: 'Kontakta oss', en: 'Contact us' },
            recommendation: {
                sv: 'Det här passar bäst som ett kontaktärende.',
                en: 'This is best handled as a contact request.'
            }
        }
    };
    const ROUTE_TOKEN_PATTERNS = [
        { pattern: /%kapellförfrågan%|%kapellforfragan%/gi, action: 'Kapellforfragan' },
        { pattern: /%fenderförfrågan%|%fenderforfragan%/gi, action: 'Fenderforfragan' },
        { pattern: /%kontakt%/gi, action: 'Kontakt' }
    ];
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
        wants_cover: { sv: 'Önskar kapell', en: 'Wants canopy' },
        wants_fender_socks: { sv: 'Önskar fenderstrumpor', en: 'Wants fender socks' },
        size: { sv: 'Storlek', en: 'Size' },
        quantity: { sv: 'Antal', en: 'Quantity' },
        subject: { sv: 'Ämne', en: 'Subject' },
        message: { sv: 'Meddelande', en: 'Message' }
    };

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

    function loadState() {
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

    function getGreeting(language) {
        return language === 'en' ? GREETING_EN : GREETING_SV;
    }

    function normalizeAction(value) {
        const action = String(value || '').trim();
        return ACTION_KEYS.includes(action) ? action : '';
    }

    function getRouteConfig(actionKey) {
        return ROUTE_CONFIG[actionKey] || ROUTE_CONFIG.Kontakt;
    }

    function extractRouteActions(content) {
        let text = String(content || '');
        const actions = [];
        ROUTE_TOKEN_PATTERNS.forEach((entry) => {
            if (entry.pattern.test(text) && !actions.includes(entry.action)) {
                actions.push(entry.action);
            }
            entry.pattern.lastIndex = 0;
            text = text.replace(entry.pattern, '');
        });
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        return { text, actions };
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
            return value
                .map((item) => formatSummaryValue(item))
                .filter(Boolean)
                .join(', ');
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

    function createWidget() {
        const root = document.createElement('div');
        root.id = 'hen-chat-widget';

        const style = document.createElement('style');
        style.textContent = `
#hen-chat-widget {
  --hen-navy-900: #0a1d33;
  --hen-navy-800: #0f2945;
  --hen-navy-700: #143656;
  --hen-gold: #c9a24a;
  --hen-gold-soft: #e2c277;
  --hen-ink: #0f172a;
  --hen-muted: #64748b;
  --hen-line: #e6ecf2;
  --hen-line-strong: #cfd9e4;
  --hen-surface: #ffffff;
  --hen-surface-soft: #f6f8fb;
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  font-family: "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
}
#hen-chat-widget, #hen-chat-widget * {
  box-sizing: border-box;
}
#hen-chat-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(10, 29, 51, 0.36);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
#hen-chat-shell {
  position: absolute;
  right: 22px;
  bottom: 22px;
  width: min(420px, calc(100vw - 28px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 16px;
}
#hen-chat-panel {
  width: 100%;
  min-height: 620px;
  max-height: min(720px, calc(100vh - 44px));
  max-height: min(720px, calc(100dvh - 44px));
  background: var(--hen-surface);
  border: 1px solid var(--hen-line);
  border-radius: 24px;
  box-shadow:
    0 32px 72px rgba(10, 29, 51, 0.22),
    0 12px 28px rgba(10, 29, 51, 0.10),
    0 1px 0 rgba(255, 255, 255, 0.8) inset;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transform: translateY(24px) scale(0.975);
  transform-origin: bottom right;
  transition: opacity 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0.28s ease;
  pointer-events: none;
}
#hen-chat-widget.open { pointer-events: auto; }
#hen-chat-widget.open #hen-chat-backdrop { opacity: 1; pointer-events: auto; }
#hen-chat-widget.open #hen-chat-panel {
  opacity: 1;
  visibility: visible;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
#hen-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  color: #ffffff;
  background:
    radial-gradient(120% 160% at 0% 0%, rgba(201, 162, 74, 0.22) 0%, rgba(201, 162, 74, 0) 55%),
    linear-gradient(135deg, var(--hen-navy-800) 0%, var(--hen-navy-900) 100%);
  position: relative;
}
#hen-chat-header::after {
  content: '';
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(201, 162, 74, 0.45), transparent);
}
#hen-chat-brand { display: flex; align-items: center; min-width: 0; }
#hen-chat-title {
  font-size: 1rem;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.01em;
}
#hen-chat-header-actions { display: inline-flex; align-items: center; }
#hen-chat-close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}
#hen-chat-close:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(201, 162, 74, 0.55);
  color: #ffffff;
  transform: translateY(-1px);
}
#hen-chat-close { font-size: 1rem; line-height: 1; }
#hen-chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px 18px 16px;
  background:
    radial-gradient(800px 300px at 100% 0%, rgba(201, 162, 74, 0.06) 0%, rgba(201, 162, 74, 0) 60%),
    linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  scrollbar-width: thin;
  scrollbar-color: #cfd9e4 transparent;
}
#hen-chat-scroll::-webkit-scrollbar { width: 8px; }
#hen-chat-scroll::-webkit-scrollbar-thumb { background: #d6dee8; border-radius: 999px; }
#hen-chat-intro {
  display: none;
  padding: 16px;
  border: 1px solid var(--hen-line);
  border-radius: 18px;
  background: var(--hen-surface);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}
#hen-chat-intro-title {
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--hen-muted);
  margin-bottom: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
#hen-chat-route-grid,
#hen-chat-recommendation-secondary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.hen-route-card,
.hen-secondary-route {
  width: 100%;
  padding: 12px 13px;
  border-radius: 14px;
  border: 1px solid var(--hen-line-strong);
  background: var(--hen-surface);
  color: var(--hen-ink);
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
}
.hen-route-card:hover,
.hen-secondary-route:hover {
  background: #fffdf7;
  border-color: var(--hen-gold);
  color: var(--hen-navy-900);
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(201, 162, 74, 0.14);
}
.hen-route-card-arrow,
.hen-secondary-route-arrow {
  color: var(--hen-gold);
  font-weight: 700;
  transition: transform 0.18s ease;
}
.hen-route-card:hover .hen-route-card-arrow,
.hen-secondary-route:hover .hen-secondary-route-arrow { transform: translateX(2px); }
#hen-chat-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hen-msg {
  max-width: 86%;
  padding: 11px 14px;
  border-radius: 18px;
  line-height: 1.55;
  font-size: 0.92rem;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.06);
}
.hen-msg.user {
  align-self: flex-end;
  background: linear-gradient(135deg, var(--hen-navy-700) 0%, var(--hen-navy-900) 100%);
  color: #ffffff;
  border-bottom-right-radius: 6px;
  box-shadow: 0 10px 22px rgba(10, 29, 51, 0.22);
}
.hen-msg.assistant {
  align-self: flex-start;
  background: var(--hen-surface);
  color: var(--hen-ink);
  border: 1px solid var(--hen-line);
  border-bottom-left-radius: 6px;
}
.hen-msg.typing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 58px;
  padding: 12px 14px;
}
.hen-msg-content { white-space: pre-wrap; word-break: break-word; }
.hen-msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.hen-msg-route {
  border: 1px solid var(--hen-line);
  border-radius: 12px;
  background: linear-gradient(135deg, var(--hen-navy-900) 0%, var(--hen-navy-700) 100%);
  color: #ffffff;
  padding: 10px 14px;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.hen-msg-route:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(10, 29, 51, 0.18);
}
.hen-msg a {
  color: var(--hen-gold);
  text-decoration: underline;
  text-underline-offset: 0.14em;
  font-weight: 600;
}
.hen-msg.user a { color: var(--hen-gold-soft); }
.hen-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--hen-muted);
  opacity: 0.4;
  animation: henPulse 1.2s infinite ease-in-out;
}
.hen-dot:nth-child(2) { animation-delay: 0.15s; }
.hen-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes henPulse {
  0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}
`;

        const backdrop = document.createElement('button');
        backdrop.id = 'hen-chat-backdrop';
        backdrop.type = 'button';
        backdrop.setAttribute('aria-label', 'Close chat');

        const shell = document.createElement('div');
        shell.id = 'hen-chat-shell';
        style.textContent += `
#hen-chat-summary,
#hen-chat-fender-tools,
#hen-chat-recommendation {
  display: none;
  border: 1px solid var(--hen-line);
  border-radius: 18px;
  background: var(--hen-surface);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
}
#hen-chat-summary { padding: 15px 16px; }
#hen-chat-summary-text { color: var(--hen-ink); font-size: 0.88rem; }
#hen-chat-summary-heading {
  margin-bottom: 10px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--hen-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
#hen-chat-summary-list { margin: 0; padding-left: 18px; }
#hen-chat-summary-list li { margin: 0 0 6px 0; }
#hen-chat-summary-empty { color: var(--hen-muted); white-space: pre-wrap; }
#hen-chat-summary-submit {
  display: none;
  width: 100%;
  margin-top: 12px;
  border: 1px solid var(--hen-gold);
  border-radius: 14px;
  background: linear-gradient(135deg, var(--hen-gold) 0%, #a8832d 100%);
  color: var(--hen-navy-900);
  padding: 12px 14px;
  font: inherit;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
  box-shadow: 0 10px 22px rgba(201, 162, 74, 0.28);
}
#hen-chat-summary-submit:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(201, 162, 74, 0.36);
}
#hen-chat-summary-submit[disabled] { opacity: 0.75; cursor: wait; }
#hen-chat-fender-tools { padding: 15px 16px; }
#hen-chat-fender-guide-link {
  display: inline-block;
  margin-bottom: 10px;
  color: var(--hen-navy-800);
  font-size: 0.84rem;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 0.14em;
  text-decoration-color: var(--hen-gold);
}
#hen-chat-fender-size {
  width: 100%;
  border: 1px solid var(--hen-line-strong);
  border-radius: 12px;
  padding: 11px 12px;
  background: var(--hen-surface-soft);
  color: var(--hen-ink);
  font: inherit;
}
#hen-chat-fender-note { margin-top: 8px; font-size: 0.78rem; color: var(--hen-muted); min-height: 1em; }
#hen-chat-recommendation {
  padding: 16px;
  background:
    radial-gradient(120% 160% at 100% 0%, rgba(201, 162, 74, 0.1) 0%, rgba(201, 162, 74, 0) 60%),
    var(--hen-surface);
  border-color: rgba(201, 162, 74, 0.35);
}
#hen-chat-recommendation-copy { font-size: 0.9rem; color: var(--hen-ink); margin-bottom: 12px; line-height: 1.5; }
#hen-chat-recommendation-primary { margin-bottom: 8px; }
.hen-primary-route {
  width: 100%;
  border: 1px solid var(--hen-navy-900);
  border-radius: 14px;
  background: linear-gradient(135deg, var(--hen-navy-700) 0%, var(--hen-navy-900) 100%);
  color: #ffffff;
  padding: 13px 15px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  box-shadow: 0 12px 26px rgba(10, 29, 51, 0.24);
  position: relative;
  overflow: hidden;
}
.hen-primary-route::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 30%, rgba(201, 162, 74, 0.18) 60%, transparent 100%);
  transform: translateX(-100%);
  transition: transform 0.6s ease;
}
.hen-primary-route:hover::before { transform: translateX(100%); }
.hen-primary-route:hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 32px rgba(10, 29, 51, 0.32);
}
#hen-chat-actions {
  padding: 14px 18px 18px;
  border-top: 1px solid var(--hen-line);
  background: var(--hen-surface);
}
#hen-chat-input-shell { display: flex; gap: 10px; align-items: flex-end; }
#hen-chat-input {
  flex: 1;
  border: 1px solid var(--hen-line-strong);
  border-radius: 16px;
  padding: 13px 15px;
  min-height: 50px;
  max-height: 136px;
  resize: none;
  overflow-y: auto;
  background: var(--hen-surface-soft);
  color: var(--hen-ink);
  font: inherit;
  line-height: 1.5;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
#hen-chat-input::placeholder { color: #94a3b8; }
#hen-chat-input:focus {
  outline: none;
  background: #ffffff;
  border-color: var(--hen-gold);
  box-shadow: 0 0 0 4px rgba(201, 162, 74, 0.15);
}
#hen-chat-send {
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  border: 1px solid var(--hen-navy-900);
  border-radius: 16px;
  background: linear-gradient(135deg, var(--hen-navy-700) 0%, var(--hen-navy-900) 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
  box-shadow: 0 10px 22px rgba(10, 29, 51, 0.22);
}
#hen-chat-send:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(10, 29, 51, 0.3), 0 0 0 3px rgba(201, 162, 74, 0.25);
}
#hen-chat-send:disabled { opacity: 0.6; cursor: wait; box-shadow: none; transform: none; }
#hen-chat-send svg { width: 18px; height: 18px; }
#hen-chat-toggle {
  position: relative;
  border: none;
  border-radius: 999px;
  padding: 0;
  width: 62px;
  height: 62px;
  background: linear-gradient(135deg, var(--hen-navy-700) 0%, var(--hen-navy-900) 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow:
    0 18px 38px rgba(10, 29, 51, 0.38),
    0 0 0 1px rgba(201, 162, 74, 0.35) inset,
    0 1px 0 rgba(255, 255, 255, 0.18) inset;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.22s ease, opacity 0.22s ease;
  pointer-events: auto;
}
#hen-chat-toggle::before {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 999px;
  background: radial-gradient(closest-side, rgba(201, 162, 74, 0.35), rgba(201, 162, 74, 0) 70%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
#hen-chat-toggle:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow:
    0 24px 44px rgba(10, 29, 51, 0.44),
    0 0 0 1px rgba(201, 162, 74, 0.55) inset,
    0 1px 0 rgba(255, 255, 255, 0.22) inset;
}
#hen-chat-toggle:hover::before { opacity: 1; }
#hen-chat-widget.open #hen-chat-toggle {
  opacity: 0;
  pointer-events: none;
  transform: translateY(14px) scale(0.9);
}
#hen-chat-toggle-icon {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--hen-gold-soft);
}
#hen-chat-toggle-icon svg { width: 26px; height: 26px; }
#hen-chat-toggle-label {
  position: absolute;
  right: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  background: var(--hen-navy-900);
  color: #ffffff;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 10px;
  box-shadow: 0 10px 20px rgba(10, 29, 51, 0.25);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
#hen-chat-toggle-label::after {
  content: '';
  position: absolute;
  right: -4px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--hen-navy-900);
}
#hen-chat-toggle:hover #hen-chat-toggle-label {
  opacity: 1;
  transform: translateY(-50%) translateX(-2px);
}
@media (max-width: 720px) {
  #hen-chat-shell {
    right: 14px;
    bottom: calc(14px + env(safe-area-inset-bottom, 0px));
    width: calc(100vw - 24px);
  }
  #hen-chat-panel {
    min-height: min(640px, calc(100dvh - 24px - env(safe-area-inset-bottom, 0px)));
    max-height: calc(100vh - 24px - env(safe-area-inset-bottom, 0px));
    max-height: calc(100dvh - 24px - env(safe-area-inset-bottom, 0px));
    border-radius: 20px;
  }
  #hen-chat-route-grid,
  #hen-chat-recommendation-secondary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  #hen-chat-toggle-label { display: none; }
  #hen-chat-toggle { width: 56px; height: 56px; }
}
@media (max-width: 520px) {
  #hen-chat-header,
  #hen-chat-scroll,
  #hen-chat-actions {
    padding-left: 14px;
    padding-right: 14px;
  }
  #hen-chat-route-grid {
    grid-template-columns: 1fr;
  }
  .hen-msg {
    max-width: 94%;
  }
}
@media (prefers-reduced-motion: reduce) {
  #hen-chat-backdrop,
  #hen-chat-panel,
  #hen-chat-toggle,
  #hen-chat-close,
  .hen-route-card,
  .hen-secondary-route,
  .hen-primary-route,
  #hen-chat-send,
  .hen-dot {
    transition: none !important;
    animation: none !important;
  }
}
`;

        const panel = document.createElement('section');
        panel.id = 'hen-chat-panel';
        panel.setAttribute('aria-label', 'Henricssons Support');
        panel.innerHTML = `
<div id="hen-chat-header">
  <div id="hen-chat-brand">
    <div id="hen-chat-title">Henricssons Support</div>
  </div>
  <div id="hen-chat-header-actions">
    <button id="hen-chat-close" type="button" aria-label="Stäng" title="Stäng">×</button>
  </div>
</div>
<div id="hen-chat-scroll">
  <section id="hen-chat-intro">
    <div id="hen-chat-intro-title">Välj väg eller skriv en fråga</div>
    <div id="hen-chat-route-grid">
      <button class="hen-route-card" data-route="Kapellforfragan" type="button"></button>
      <button class="hen-route-card" data-route="Fenderforfragan" type="button"></button>
      <button class="hen-route-card" data-route="Kontakt" type="button"></button>
    </div>
  </section>
  <div id="hen-chat-messages"></div>
  <div id="hen-chat-summary">
    <div id="hen-chat-summary-text"></div>
    <button id="hen-chat-summary-submit" type="button">Skicka</button>
  </div>
  <div id="hen-chat-fender-tools">
    <a id="hen-chat-fender-guide-link" href="${FENDER_GUIDE_URL}" target="_blank" rel="noopener noreferrer">${FENDER_GUIDE_TEXT_SV}</a>
    <select id="hen-chat-fender-size">
      <option value="">Välj storlek...</option>
    </select>
    <div id="hen-chat-fender-note"></div>
  </div>
  <div id="hen-chat-recommendation">
    <div id="hen-chat-recommendation-copy"></div>
    <div id="hen-chat-recommendation-primary"></div>
    <div id="hen-chat-recommendation-secondary"></div>
  </div>
</div>
<div id="hen-chat-actions">
  <div id="hen-chat-input-shell">
    <textarea id="hen-chat-input" rows="1" placeholder="Skriv din fråga..."></textarea>
    <button id="hen-chat-send" type="button" aria-label="Skicka" title="Skicka">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6l.1 6.6 12.5 1.8-12.5 1.8-.1 6.6Z"/></svg>
    </button>
  </div>
</div>`;

        const toggle = document.createElement('button');
        toggle.id = 'hen-chat-toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-label', 'Open chat');
        toggle.title = 'Open chat';
        toggle.innerHTML = `
<span id="hen-chat-toggle-icon" aria-hidden="true">
  <svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M12 3c5 0 9 3.58 9 8 0 4.42-4 8-9 8a10.6 10.6 0 0 1-3.3-.52L4 20l1.24-3.56A7.5 7.5 0 0 1 3 11c0-4.42 4-8 9-8Zm-3.2 7.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm3.2 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm3.2 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>
</span>
<span id="hen-chat-toggle-label">Support</span>`;

        shell.appendChild(panel);
        shell.appendChild(toggle);

        root.appendChild(style);
        root.appendChild(backdrop);
        root.appendChild(shell);
        document.body.appendChild(root);

        return { root, panel, toggle, backdrop };
    }

    function renderMessageText(container, content) {
        const wrapper = document.createElement('div');
        wrapper.className = 'hen-msg-content';

        const text = String(content || '');
        const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
        let cursor = 0;
        let match = pattern.exec(text);
        while (match) {
            if (match.index > cursor) {
                wrapper.appendChild(document.createTextNode(text.slice(cursor, match.index)));
            }
            const anchor = document.createElement('a');
            const href = match[2] || match[3];
            anchor.href = href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = match[1] || href;
            wrapper.appendChild(anchor);
            cursor = pattern.lastIndex;
            match = pattern.exec(text);
        }
        if (cursor < text.length) {
            wrapper.appendChild(document.createTextNode(text.slice(cursor)));
        }

        container.appendChild(wrapper);
    }

    function appendMessage(container, role, content) {
        const message = document.createElement('div');
        message.className = `hen-msg ${role}`;
        const parsed = role === 'assistant'
            ? extractRouteActions(content)
            : { text: String(content || ''), actions: [] };

        if (parsed.text) {
            renderMessageText(message, parsed.text);
        }

        if (role === 'assistant' && parsed.actions.length) {
            const actionsWrap = document.createElement('div');
            actionsWrap.className = 'hen-msg-actions';
            parsed.actions.forEach((actionKey) => {
                const config = getRouteConfig(actionKey);
                const button = document.createElement('button');
                button.className = 'hen-msg-route';
                button.type = 'button';
                button.dataset.route = actionKey;
                button.textContent = t(config.button.sv, config.button.en);
                actionsWrap.appendChild(button);
            });
            message.appendChild(actionsWrap);
        }
        container.appendChild(message);
    }

    function appendTypingBubble(container) {
        const bubble = document.createElement('div');
        bubble.className = 'hen-msg assistant typing';
        for (let index = 0; index < 3; index += 1) {
            const dot = document.createElement('span');
            dot.className = 'hen-dot';
            bubble.appendChild(dot);
        }
        container.appendChild(bubble);
    }

    function renderStaticCopy(ui) {
        ui.toggleLabel.textContent = t('Support', 'Support');
        ui.toggle.setAttribute('aria-label', t('Öppna support', 'Open support'));
        ui.toggle.title = t('Öppna support', 'Open support');
        ui.input.placeholder = t('Skriv din fråga...', 'Write your question...');
        ui.sendBtn.setAttribute('aria-label', t('Skicka', 'Send'));
        ui.sendBtn.title = t('Skicka', 'Send');
        ui.closeBtn.setAttribute('aria-label', t('Stäng', 'Close'));
        ui.closeBtn.title = t('Stäng', 'Close');
        ui.introTitle.textContent = t('Välj väg eller skriv en fråga', 'Choose a route or ask a question');

        ui.routeButtons.forEach((button) => {
            const actionKey = normalizeAction(button.dataset.route);
            if (!actionKey) return;
            const config = getRouteConfig(actionKey);
            button.innerHTML = `
<span class="hen-route-card-label">${t(config.short.sv, config.short.en)}</span>
<span class="hen-route-card-arrow" aria-hidden="true">›</span>`;
        });
    }

    function renderMessages(ui) {
        renderStaticCopy(ui);

        const hasUserMessages = state.history.some((item) => item && item.role === 'user');
        ui.intro.style.display = hasUserMessages ? 'none' : 'block';

        ui.messages.innerHTML = '';
        state.history.forEach((item) => {
            if (!item || !item.role || !item.content) return;
            appendMessage(ui.messages, item.role === 'user' ? 'user' : 'assistant', String(item.content));
        });

        if (state.isTyping) {
            appendTypingBubble(ui.messages);
        }


        ui.scroll.scrollTop = ui.scroll.scrollHeight;
    }

    function buildOutgoingMessage(trimmedText) {
        return String(trimmedText || '').trim();
    }

    async function sendMessage(message, ui) {
        const trimmed = String(message || '').trim();
        if (!trimmed || state.isTyping || state.isSubmitting) return;

        const outgoingMessage = buildOutgoingMessage(trimmed);
        state.confirmed = false;
        state.isTyping = true;
        state.history.push({ role: 'user', content: trimmed });
        state.history = state.history.slice(-MAX_HISTORY);
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
        } catch (error) {
            state.history.push({
                role: 'assistant',
                content: t(
                    `Jag kunde inte svara just nu: ${error.message}`,
                    `I could not answer right now: ${error.message}`
                )
            });
            state.history = state.history.slice(-MAX_HISTORY);
            saveState();
        } finally {
            state.isTyping = false;
            ui.sendBtn.disabled = false;
            ui.input.disabled = false;
            ui.input.value = '';
            autoResizeInput(ui.input);
            renderMessages(ui);
            if (shouldAutoFocusInput()) {
                ui.input.focus({ preventScroll: true });
            }
        }
    }

    function resetChat(ui) {
        const language = state.language === 'en' ? 'en' : 'sv';
        state = {
            ...defaultState,
            language,
            history: [{ role: 'assistant', content: getGreeting(language) }]
        };
        saveState();
        renderMessages(ui);
    }

    function autoResizeInput(inputEl) {
        if (!inputEl) return;
        inputEl.style.height = 'auto';
        const nextHeight = Math.min(inputEl.scrollHeight, 136);
        inputEl.style.height = `${Math.max(nextHeight, 48)}px`;
    }

    function shouldAutoFocusInput() {
        const hasMatchMedia = typeof window.matchMedia === 'function';
        const isCoarsePointer = hasMatchMedia && window.matchMedia('(pointer: coarse)').matches;
        const isNarrowViewport = window.innerWidth <= 720;
        return !(isCoarsePointer || isNarrowViewport);
    }

    function setPanelOpen(ui, isOpen) {
        ui.root.classList.toggle('open', Boolean(isOpen));
        if (isOpen && shouldAutoFocusInput()) {
            requestAnimationFrame(() => {
                ui.input.focus({ preventScroll: true });
            });
        }
    }

    function navigateToRoute(actionKey) {
        const normalized = normalizeAction(actionKey);
        if (!normalized) return;

        const href = getRouteConfig(normalized).href;
        if (!href) return;

        const targetUrl = new URL(href, window.location.origin);
        const samePage = targetUrl.pathname === window.location.pathname;
        if (samePage && targetUrl.hash) {
            const target = document.querySelector(targetUrl.hash);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                window.location.hash = targetUrl.hash;
                return;
            }
        }

        window.location.assign(targetUrl.toString());
    }

    function init() {
        const { root, panel, toggle, backdrop } = createWidget();
        const ui = {
            root,
            panel,
            toggle,
            backdrop,
            title: panel.querySelector('#hen-chat-title'),
            closeBtn: panel.querySelector('#hen-chat-close'),
            scroll: panel.querySelector('#hen-chat-scroll'),
            intro: panel.querySelector('#hen-chat-intro'),
            introTitle: panel.querySelector('#hen-chat-intro-title'),
            routeButtons: Array.from(panel.querySelectorAll('.hen-route-card')),
            messages: panel.querySelector('#hen-chat-messages'),
            input: panel.querySelector('#hen-chat-input'),
            sendBtn: panel.querySelector('#hen-chat-send'),
            toggleLabel: root.querySelector('#hen-chat-toggle-label')
        };


        renderMessages(ui);
        autoResizeInput(ui.input);

        ui.toggle.addEventListener('click', () => setPanelOpen(ui, true));
        ui.closeBtn.addEventListener('click', () => setPanelOpen(ui, false));
        ui.backdrop.addEventListener('click', () => setPanelOpen(ui, false));
        ui.sendBtn.addEventListener('click', () => sendMessage(ui.input.value, ui));
        ui.input.addEventListener('input', () => autoResizeInput(ui.input));
        ui.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                sendMessage(ui.input.value, ui);
            }
        });
        ui.panel.addEventListener('click', (event) => {
            const routeButton = event.target.closest('[data-route]');
            if (!routeButton) return;
            navigateToRoute(routeButton.getAttribute('data-route'));
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && ui.root.classList.contains('open')) {
                setPanelOpen(ui, false);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
