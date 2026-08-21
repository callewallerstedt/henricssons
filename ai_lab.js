(() => {
    "use strict";

    const state = {
        submissions: [],
        selected: null,
        filter: "all",
        search: "",
        sourceMode: "manual",
        settings: null,
        runtime: null,
        activeRun: null,
        running: false,
    };

    const viewMeta = {
        inbox: { eyebrow: "AI OPERATIONS", title: "Inkommande förfrågningar" },
        tv: { eyebrow: "FACTORY BROADCAST", title: "Live Order TV" },
        workspace: { eyebrow: "DRY RUN WORKSPACE", title: "Agentstudio" },
        notifications: { eyebrow: "EXPERIMENT", title: "Notiser" },
        settings: { eyebrow: "SYSTEM CONTROL", title: "AI Lab inställningar" },
    };

    const fieldLabels = {
        name: "Namn", namn: "Namn", email: "E-post", epost: "E-post", phone: "Telefon",
        telefon: "Telefon", manufacturer: "Tillverkare", tillverkare: "Tillverkare",
        model: "Modell", modell: "Modell", boat_year: "Årsmodell", arsmodell: "Årsmodell",
        address: "Adress", adress: "Adress", postal_code: "Postnummer", city: "Ort", ort: "Ort",
        message: "Meddelande", meddelande: "Meddelande", subject: "Ämne", amne: "Ämne",
        home_port: "Hemmahamn", old_canopy: "Befintligt kapell", quantity: "Antal", size: "Storlek",
    };

    const workingSteps = [
        { id: "ingest", label: "Läser förfrågan", detail: "Strukturerar kunddata" },
        { id: "classify", label: "Klassificerar", detail: "Identifierar behov" },
        { id: "catalog", label: "Matchar artikel", detail: "Kontrollerar datakälla" },
        { id: "stock", label: "Kontrollerar lager", detail: "Kontrollerar datakälla" },
        { id: "compose", label: "Skriver kundsvar", detail: "Tillämpar mejlstil" },
        { id: "quote", label: "Bygger offert", detail: "Fyller offertmall" },
        { id: "safety", label: "Säkerhetskontroll", detail: "Verifierar dry run" },
    ];

    const $ = id => document.getElementById(id);

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeKey(value) {
        return String(value || "")
            .replace(/^\d+\.\s*/, "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
    }

    function getField(fields, ...names) {
        if (!fields || typeof fields !== "object") return "";
        const wanted = new Set(names.map(normalizeKey));
        for (const [key, value] of Object.entries(fields)) {
            if (wanted.has(normalizeKey(key)) && value != null && String(value).trim()) return String(value).trim();
        }
        return "";
    }

    function getCustomerName(item) {
        return getField(item.fields, "name", "namn") || item.title || "Okänd kund";
    }

    function getBoat(item) {
        const manufacturer = getField(item.fields, "manufacturer", "tillverkare", "boat_brand", "båtmärke");
        const model = getField(item.fields, "model", "modell", "boat_model", "båtmodell");
        return [manufacturer, model].filter(Boolean).join(" ") || "Båtmodell saknas";
    }

    function getMessage(item) {
        return getField(item.fields, "message", "meddelande", "övrig information", "övriga önskemål")
            || item.form_summary || item.description || "Ingen fritext angiven.";
    }

    function formatDate(value, withTime = false) {
        if (!value) return "Okänt datum";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        const options = withTime
            ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
            : { day: "numeric", month: "short" };
        return new Intl.DateTimeFormat("sv-SE", options).format(date);
    }

    function initials(value) {
        return String(value || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
    }

    async function adminFetch(url, options = {}) {
        const response = await fetch(url, { credentials: "include", ...options });
        if (response.status === 401 || response.status === 403) {
            window.location.assign("/admin?auth=required");
            throw new Error("Adminsessionen har gått ut");
        }
        return response;
    }

    function showToast(message) {
        const toast = $("lab-toast");
        toast.textContent = message;
        toast.classList.add("is-visible");
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
    }

    function switchView(view) {
        document.querySelectorAll("[data-view-panel]").forEach(panel => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
        document.querySelectorAll(".lab-nav-button").forEach(button => button.classList.toggle("is-active", button.dataset.view === view));
        const meta = viewMeta[view] || viewMeta.inbox;
        $("page-eyebrow").textContent = meta.eyebrow;
        $("page-title").textContent = meta.title;
        closeMobileNav();
        window.scrollTo({ top: 0, behavior: "smooth" });
        if (view === "tv") startTv(); else stopTv();
    }

    function closeMobileNav() {
        document.querySelector(".lab-sidebar")?.classList.remove("is-open");
        $("mobile-nav-backdrop")?.classList.remove("is-open");
    }

    async function loadInbox() {
        const list = $("request-list");
        list.innerHTML = '<div class="list-loading"><span class="lab-spinner"></span><p>Laddar förfrågningar</p></div>';
        try {
            const response = await adminFetch("/api/get_form_submissions");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            state.submissions = Array.isArray(data) ? data : [];
            updateMetrics();
            renderInbox();
            if (state.selected) {
                state.selected = state.submissions.find(item => String(item.id) === String(state.selected.id)) || null;
                renderSelected();
            }
        } catch (error) {
            list.innerHTML = `<div class="empty-list"><p>Kunde inte läsa inkommande ärenden.<br>${escapeHtml(error.message)}</p></div>`;
        }
    }

    function updateMetrics() {
        const total = state.submissions.length;
        const newCount = state.submissions.filter(item => String(item.status || "nya-inskick") === "nya-inskick").length;
        $("metric-total").textContent = String(total);
        $("metric-new").textContent = String(newCount);
        $("nav-inbox-count").textContent = String(newCount || total);
    }

    function filteredSubmissions() {
        const query = state.search.trim().toLowerCase();
        return state.submissions.filter(item => {
            const formType = String(item.form_type || "Kontakt");
            const passesType = state.filter === "all" || formType.toLowerCase().includes(state.filter.toLowerCase());
            if (!passesType) return false;
            if (!query) return true;
            const haystack = [getCustomerName(item), getBoat(item), getMessage(item), item.form_summary, getField(item.fields, "email")].join(" ").toLowerCase();
            return haystack.includes(query);
        });
    }

    function renderInbox() {
        const list = $("request-list");
        const items = filteredSubmissions();
        if (!items.length) {
            list.innerHTML = '<div class="empty-list"><p>Inga förfrågningar matchar filtret.</p></div>';
            return;
        }
        list.innerHTML = items.map(item => {
            const name = getCustomerName(item);
            const boat = getBoat(item);
            const summary = getMessage(item).replace(/\s+/g, " ");
            const active = state.selected && String(state.selected.id) === String(item.id);
            return `
                <button class="request-item ${active ? "is-active" : ""}" type="button" data-request-id="${escapeHtml(item.id)}">
                    <span class="request-avatar">${escapeHtml(initials(name))}</span>
                    <span class="request-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(boat)}</span><small>${escapeHtml(summary.slice(0, 92))}</small></span>
                    <span class="request-time">${escapeHtml(formatDate(item.timestamp || item.date))}${item.read ? "" : '<i class="unread-dot"></i>'}</span>
                </button>`;
        }).join("");
        list.querySelectorAll("[data-request-id]").forEach(button => {
            button.addEventListener("click", () => selectSubmission(button.dataset.requestId));
        });
    }

    function selectSubmission(id) {
        state.selected = state.submissions.find(item => String(item.id) === String(id)) || null;
        renderInbox();
        renderSelected();
        updateSelectedSourceSummary();
    }

    function renderSelected() {
        const item = state.selected;
        $("empty-detail").classList.toggle("is-hidden", Boolean(item));
        $("request-detail").classList.toggle("is-hidden", !item);
        if (!item) return;

        const name = getCustomerName(item);
        const email = getField(item.fields, "email", "e-post", "e-postadress");
        const phone = getField(item.fields, "phone", "telefon", "telefonnummer");
        const status = String(item.status || "nya-inskick");
        $("detail-customer").textContent = name;
        $("detail-meta").textContent = `${formatDate(item.timestamp || item.date, true)} · Referens ${item.id}`;
        $("detail-boat").textContent = getBoat(item);
        $("detail-contact").textContent = email || phone || "Saknas";
        $("detail-status").textContent = status.replace(/-/g, " ");
        $("detail-message").textContent = getMessage(item);
        $("detail-tags").innerHTML = `<span class="detail-tag">${escapeHtml(item.form_type || "Kontakt")}</span><span class="detail-tag status">${escapeHtml(status.replace(/-/g, " "))}</span>`;

        const fields = item.fields && typeof item.fields === "object" ? item.fields : {};
        const entries = Object.entries(fields).filter(([key, value]) => !String(key).startsWith("__") && value && !["message", "meddelande", "ovrig_information", "ovriga_onskemal"].includes(normalizeKey(key)));
        $("detail-field-list").innerHTML = entries.slice(0, 12).map(([key, value]) => {
            const normalized = normalizeKey(key);
            const label = fieldLabels[normalized] || String(key).replace(/^\d+\.\s*/, "").replace(/_/g, " ");
            return `<div class="detail-field"><span>${escapeHtml(label)}</span><b title="${escapeHtml(value)}">${escapeHtml(value)}</b></div>`;
        }).join("");
    }

    function updateSelectedSourceSummary() {
        const item = state.selected;
        $("selected-source-tab").disabled = !item;
        if (!item) {
            $("selected-source-type").textContent = "FÖRFRÅGAN";
            $("selected-source-title").textContent = "Inget ärende valt";
            $("selected-source-copy").textContent = "Välj ett ärende från Inkommande först.";
            return;
        }
        $("selected-source-type").textContent = String(item.form_type || "FÖRFRÅGAN").toUpperCase();
        $("selected-source-title").textContent = `${getCustomerName(item)} · ${getBoat(item)}`;
        $("selected-source-copy").textContent = getMessage(item).replace(/\s+/g, " ").slice(0, 240);
    }

    function setSourceMode(mode) {
        if (mode === "selected" && !state.selected) {
            showToast("Välj först ett ärende från Inkommande");
            return;
        }
        state.sourceMode = mode;
        document.querySelectorAll("[data-source]").forEach(button => button.classList.toggle("is-active", button.dataset.source === mode));
        $("manual-source-fields").classList.toggle("is-hidden", mode !== "manual");
        $("selected-source-summary").classList.toggle("is-hidden", mode !== "selected");
    }

    function openManualWorkspace() {
        switchView("workspace");
        setSourceMode("manual");
        if (!$("manual-body").value.trim()) {
            $("manual-from").value = "kund@example.se";
            $("manual-subject").value = "Förfrågan om kapell till Buster Magnum";
            $("manual-body").value = "Hej, jag har en Buster Magnum från 2003 och behöver ett nytt kapell. Det gamla originalkapellet har börjat släppa i materialet. Jag vill gärna veta pris, vilka färger som finns och hur snabbt ni kan leverera. Med vänlig hälsning, Lars";
        }
        $("manual-body").focus();
    }

    function runSelectedFromInbox() {
        if (!state.selected) return;
        switchView("workspace");
        setSourceMode("selected");
        setTimeout(runAgent, 220);
    }

    function renderWorkingTrace(activeIndex = 0) {
        $("trace-grid").innerHTML = workingSteps.map((step, index) => {
            const status = index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : "";
            const icon = index < activeIndex ? "OK" : String(index + 1).padStart(2, "0");
            return `<div class="trace-step ${status}"><span class="trace-step-icon">${icon}</span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div>`;
        }).join("");
        $("agent-progress-fill").style.width = `${Math.min(88, 8 + activeIndex * 13)}%`;
    }

    function renderServerTrace(trace) {
        const items = Array.isArray(trace) ? trace : [];
        $("trace-grid").innerHTML = items.map((step, index) => {
            const status = `is-${step.status || "complete"}`;
            const icon = step.status === "complete" ? "OK" : step.status === "blocked" ? "!" : String(index + 1).padStart(2, "0");
            return `<div class="trace-step ${status}"><span class="trace-step-icon">${icon}</span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div>`;
        }).join("");
        $("agent-progress-fill").style.width = "100%";
    }

    async function runAgent() {
        if (state.running) return;
        const payload = {};
        if (state.sourceMode === "selected") {
            if (!state.selected) return showToast("Välj ett ärende först");
            payload.submission_id = state.selected.id;
        } else {
            const body = $("manual-body").value.trim();
            if (!body) return showToast("Klistra in en förfrågan först");
            payload.manual = { from: $("manual-from").value.trim(), subject: $("manual-subject").value.trim(), body };
        }

        state.running = true;
        $("run-agent").disabled = true;
        $("run-selected-agent").disabled = true;
        $("agent-run-card").classList.remove("is-hidden");
        $("agent-results").classList.add("is-hidden");
        $("run-error").classList.add("is-hidden");
        $("run-status").className = "run-status";
        $("run-status").innerHTML = "<i></i> Arbetar";
        $("agent-run-caption").textContent = "Agenten bearbetar förfrågan";
        renderWorkingTrace(0);
        $("agent-run-card").scrollIntoView({ behavior: "smooth", block: "center" });

        let activeIndex = 0;
        const progressTimer = setInterval(() => {
            activeIndex = Math.min(activeIndex + 1, workingSteps.length - 2);
            renderWorkingTrace(activeIndex);
        }, 780);

        try {
            const response = await adminFetch("/api/ai_lab/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            state.activeRun = data;
            renderServerTrace(data.trace);
            $("run-status").className = "run-status is-complete";
            $("run-status").innerHTML = "<i></i> Klar";
            $("agent-run-caption").textContent = `${data.model || "OpenAI"} · Körning ${data.run_id || ""}`;
            renderResults(data.result || {});
            $("agent-results").classList.remove("is-hidden");
            setTimeout(() => $("agent-results").scrollIntoView({ behavior: "smooth", block: "start" }), 150);
        } catch (error) {
            $("run-error").textContent = error.message || "Agentkörningen misslyckades";
            $("run-error").classList.remove("is-hidden");
            $("run-status").className = "run-status";
            $("run-status").innerHTML = "<i></i> Avbruten";
        } finally {
            clearInterval(progressTimer);
            state.running = false;
            $("run-agent").disabled = false;
            $("run-selected-agent").disabled = false;
        }
    }

    function formatMoney(value) {
        if (value == null || Number.isNaN(Number(value))) return "-";
        return new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
    }

    function formatKr(value) {
        if (value == null || Number.isNaN(Number(value))) return "-";
        return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Number(value))} kr`;
    }

    function renderResults(result) {
        $("result-summary").textContent = result.summary || "Förfrågan analyserad";
        $("result-intent").textContent = result.intent || "Förfrågan";
        $("result-priority").textContent = result.priority || "normal";
        $("result-confidence").textContent = `${Math.round(Number(result.confidence || 0) * 100)}%`;
        const cost = result.cost_estimate || {};
        $("result-profit").textContent = cost.estimated_profit_sek != null
            ? `${formatKr(cost.estimated_profit_sek)} · ${cost.margin_percent ?? "-"}%`
            : "-";
        const blockers = Array.isArray(result.internal_blockers) ? result.internal_blockers : [];
        $("blocker-strip").innerHTML = blockers.map(item => `<span class="blocker-chip">${escapeHtml(item)}</span>`).join("");

        const email = result.email || {};
        $("email-subject-output").value = email.subject || "";
        $("email-body-output").value = email.body || "";

        const quote = result.quote || {};
        const customer = result.customer || {};
        const boat = result.boat || {};
        $("quote-number").textContent = quote.draft_number || "UTKAST";
        $("quote-customer-number").textContent = quote.customer_number || "Ej tilldelat";
        $("quote-date").textContent = quote.quote_date || "";
        $("quote-valid-until").textContent = quote.valid_until || "";
        $("quote-planned-delivery").textContent = quote.planned_delivery || "-";
        $("quote-delivery-terms").textContent = quote.delivery_terms || "";
        $("quote-delivery-method").textContent = quote.delivery_method || "";
        $("quote-payment-terms").textContent = quote.payment_terms || "";
        $("quote-customer-reference").textContent = [customer.phone, customer.email].filter(Boolean).join(" · ") || "Saknas";
        $("quote-address").textContent = [customer.name, customer.address, [customer.postal_code, customer.city].filter(Boolean).join(" ")].filter(Boolean).join("\n") || "Kunduppgifter saknas";
        const lines = Array.isArray(quote.lines) ? quote.lines : [];
        $("quote-lines").innerHTML = lines.map(line => `
            <tr>
                <td>${escapeHtml(line.article_number || "Saknas")}</td>
                <td>${escapeHtml(line.description || "Offertunderlag")}<span class="quote-verification">${escapeHtml(line.verification || "Estimerad")}</span></td>
                <td>${escapeHtml(String(line.quantity ?? 1).replace(".", ","))}</td>
                <td>${escapeHtml(line.unit || "st")}</td>
                <td>${formatMoney(line.unit_price_sek)}</td>
                <td>${line.discount_percent == null ? "-" : `${formatMoney(line.discount_percent)}%`}</td>
                <td>${formatMoney(line.sum_sek)}</td>
            </tr>`).join("");
        $("quote-subtotal").textContent = quote.subtotal_ex_vat_sek != null ? formatMoney(quote.subtotal_ex_vat_sek) : "-";
        $("quote-vat").textContent = quote.vat_sek != null ? formatMoney(quote.vat_sek) : "-";
        $("quote-rounding").textContent = quote.rounding_sek != null ? formatMoney(quote.rounding_sek) : "-";
        $("quote-total").textContent = quote.total_sek != null ? `${formatMoney(quote.total_sek)} kr` : "-";
        const boatName = [boat.manufacturer, boat.model, boat.year].filter(Boolean).join(" ");
        $("quote-blocker-note").textContent = `${boatName ? `${boatName}: ` : ""}Priser, artikelnummer och lager är AI-estimat från simulerad prisdata och verifieras innan offerten skickas till kund.`;
    }

    async function copyEmail() {
        const subject = $("email-subject-output").value.trim();
        const body = $("email-body-output").value.trim();
        try {
            await navigator.clipboard.writeText(`Ämne: ${subject}\n\n${body}`);
            showToast("Mejlutkastet kopierades");
        } catch (_) {
            $("email-body-output").select();
            document.execCommand("copy");
            showToast("Mejltexten kopierades");
        }
    }

    async function loadSettings() {
        try {
            const response = await adminFetch("/api/ai_lab/settings");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            state.settings = data.settings || {};
            state.runtime = data.runtime || {};
            renderSettings();
        } catch (error) {
            state.runtime = { openai_configured: false };
            renderRuntime();
            showSettingsNotice(`Kunde inte läsa inställningar: ${error.message}`, true);
        }
    }

    function renderRuntime() {
        const runtime = state.runtime || {};
        const pill = $("runtime-pill");
        if (runtime.openai_configured) {
            pill.className = "runtime-pill is-live";
            pill.innerHTML = `<span></span><b>${escapeHtml(runtime.model || "OpenAI aktiv")}</b>`;
        } else {
            pill.className = "runtime-pill is-error";
            pill.innerHTML = "<span></span><b>OpenAI saknar nyckel</b>";
        }
        $("settings-model").textContent = runtime.model || "Ej konfigurerat";
        $("openai-state").textContent = runtime.openai_configured ? "LIVE" : "SAKNAS";
        $("openai-state").className = runtime.openai_configured ? "integration-state" : "integration-state is-waiting";
    }

    function renderSettings() {
        const settings = state.settings || {};
        $("setting-agent-prompt").value = settings.agent_prompt || "";
        $("setting-email-style").value = settings.email_style_guide || "";
        $("setting-validity").value = settings.quote_validity_days ?? 30;
        $("setting-shipping").value = settings.default_shipping_sek ?? 280;
        $("setting-tax").value = settings.tax_rate_percent ?? 25;
        $("setting-delivery-terms").value = settings.delivery_terms || "";
        $("setting-delivery-method").value = settings.delivery_method || "";
        $("setting-payment-terms").value = settings.payment_terms || "";
        renderRuntime();
    }

    function showSettingsNotice(message, isError = false) {
        const notice = $("settings-notice");
        notice.textContent = message;
        notice.className = `settings-notice${isError ? " is-error" : ""}`;
        clearTimeout(showSettingsNotice.timer);
        showSettingsNotice.timer = setTimeout(() => notice.classList.add("is-hidden"), 3500);
    }

    async function saveSettings() {
        const button = $("save-lab-settings");
        button.disabled = true;
        button.textContent = "Sparar";
        const settings = {
            agent_prompt: $("setting-agent-prompt").value.trim(),
            email_style_guide: $("setting-email-style").value.trim(),
            quote_validity_days: Number($("setting-validity").value),
            default_shipping_sek: Number($("setting-shipping").value),
            tax_rate_percent: Number($("setting-tax").value),
            delivery_terms: $("setting-delivery-terms").value.trim(),
            delivery_method: $("setting-delivery-method").value.trim(),
            payment_terms: $("setting-payment-terms").value.trim(),
        };
        try {
            const response = await adminFetch("/api/ai_lab/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ settings }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            state.settings = data.settings || settings;
            renderSettings();
            showSettingsNotice("AI Lab inställningarna är sparade");
        } catch (error) {
            showSettingsNotice(`Kunde inte spara: ${error.message}`, true);
        } finally {
            button.disabled = false;
            button.textContent = "Spara inställningar";
        }
    }

    // ---------- Live Order TV ----------
    const tvState = {
        active: false,
        pollTimer: null,
        clockTimer: null,
        knownIds: null,
        soundOn: true,
        audioCtx: null,
    };

    const TV_POLL_MS = 30000;
    const tvWeatherIcons = { "01": "☀️", "02": "⛅", "03": "☁️", "04": "🌫️", "05": "🌧️", "06": "🌨️", "07": "⛈️" };

    function tvTypeInfo(formType) {
        const lowered = String(formType || "").toLowerCase();
        if (lowered.includes("kapell")) return { label: "KAPELL", cls: "type-kapell" };
        if (lowered.includes("dyn")) return { label: "DYNSATS", cls: "type-dynsats" };
        if (lowered.includes("fender")) return { label: "FENDER", cls: "type-fender" };
        return { label: "KONTAKT", cls: "type-kontakt" };
    }

    function ensureTvAudio() {
        if (!tvState.audioCtx) {
            try {
                tvState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (_) {
                return null;
            }
        }
        if (tvState.audioCtx.state === "suspended") tvState.audioCtx.resume().catch(() => {});
        return tvState.audioCtx;
    }

    function playTvChime() {
        if (!tvState.soundOn) return;
        const ctx = ensureTvAudio();
        if (!ctx) return;
        const now = ctx.currentTime + 0.02;
        [[987.77, 0], [1318.51, 0.18]].forEach(([frequency, delay]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.2, now + delay + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + delay);
            osc.stop(now + delay + 1.3);
        });
    }

    function tickTvClock() {
        const now = new Date();
        $("tv-clock").textContent = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
        const dateText = new Intl.DateTimeFormat("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
        $("tv-date").textContent = dateText.charAt(0).toUpperCase() + dateText.slice(1);
    }

    function tvTimeLabel(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const now = new Date();
        const clock = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date);
        if (date.toDateString() === now.toDateString()) return `${clock} · idag`;
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return `${clock} · igår`;
        return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(date);
    }

    function renderTvWeather(weather) {
        if (!weather || weather.temperature_c == null) {
            $("tv-temp").textContent = "--°";
            $("tv-weather-desc").textContent = "Kungsbacka";
            return;
        }
        $("tv-weather-icon").textContent = tvWeatherIcons[weather.icon] || "☁️";
        $("tv-temp").textContent = `${Math.round(Number(weather.temperature_c))}°C`;
        $("tv-weather-desc").textContent = `${weather.description || "Väder"} · ${weather.location || "Kungsbacka"}`;
    }

    function renderTvFeed(feed, freshIds) {
        const container = $("tv-feed");
        if (!feed.length) {
            container.innerHTML = '<div class="tv-empty"><p>Inga förfrågningar ännu.<br>Flödet uppdateras automatiskt.</p></div>';
            return;
        }
        const cutoff = Date.now() - 60 * 60 * 1000;
        container.innerHTML = feed.map(item => {
            const type = tvTypeInfo(item.form_type);
            const estimate = item.estimate || {};
            const stamp = new Date(item.timestamp).getTime();
            const fresh = freshIds.has(String(item.id)) || (Number.isFinite(stamp) && stamp > cutoff);
            const city = item.city ? `<span> · ${escapeHtml(item.city)}</span>` : "";
            const wants = item.wants ? `<p class="tv-order-wants">”${escapeHtml(item.wants)}”</p>` : "";
            const boatRow = item.boat ? `<p class="tv-order-boat">⚓ ${escapeHtml(item.boat)}</p>` : "";
            return `
                <article class="tv-order ${fresh ? "is-fresh" : ""}">
                    <div class="tv-order-top">
                        <span class="tv-order-type ${type.cls}">${type.label}</span>
                        <span class="tv-order-time">${escapeHtml(tvTimeLabel(item.timestamp))}</span>
                    </div>
                    <h4>${escapeHtml(item.customer || "Okänd kund")}${city}</h4>
                    ${boatRow}
                    ${wants}
                    <div class="tv-order-est">
                        <div><span>EST. PRIS</span><b class="est-price">${formatKr(estimate.price_sek)}</b></div>
                        <div><span>EST. VINST</span><b class="est-profit">${estimate.profit_sek != null ? `+${formatKr(estimate.profit_sek)}` : "-"}</b></div>
                        <div><span>LAGER</span><b title="${escapeHtml(estimate.stock || "")}">${escapeHtml(estimate.stock || "-")}</b></div>
                        <div><span>LEVERANS</span><b>${escapeHtml(estimate.delivery || "-")}</b></div>
                    </div>
                </article>`;
        }).join("");
    }

    function renderTvSidePanels(feed) {
        const today = new Date().toDateString();
        const todayItems = feed.filter(item => {
            const date = new Date(item.timestamp);
            return !Number.isNaN(date.getTime()) && date.toDateString() === today;
        });
        $("tv-today-count").textContent = todayItems.length ? `${todayItems.length} st` : "";
        $("tv-today-list").innerHTML = todayItems.length
            ? todayItems.map(item => {
                const clock = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.timestamp));
                const estimate = item.estimate || {};
                return `
                    <div class="tv-today-row">
                        <span class="tv-today-time">${clock}</span>
                        <div class="tv-today-copy"><strong>${escapeHtml(item.customer || "Okänd kund")}</strong><small>${escapeHtml(item.boat || estimate.product || item.form_type || "")}</small></div>
                        <span class="tv-today-value">${formatKr(estimate.price_sek)}</span>
                    </div>`;
            }).join("")
            : '<p class="tv-side-empty">Inga förfrågningar ännu idag.</p>';

        const groups = new Map();
        feed.forEach(item => {
            const estimate = item.estimate || {};
            const type = tvTypeInfo(item.form_type);
            const group = groups.get(type.label) || { label: type.label, count: 0, value: 0, profit: 0 };
            group.count += 1;
            group.value += Number(estimate.price_sek || 0);
            group.profit += Number(estimate.profit_sek || 0);
            groups.set(type.label, group);
        });
        const rows = [...groups.values()].sort((a, b) => b.profit - a.profit);
        const maxProfit = Math.max(...rows.map(row => row.profit), 1);
        $("tv-profit-list").innerHTML = rows.length
            ? rows.map(row => `
                <div class="tv-profit-row">
                    <div class="tv-profit-row-top"><span>${escapeHtml(row.label)}</span><b>+${formatKr(row.profit)}</b></div>
                    <div class="tv-profit-meta"><span>${row.count} förfrågningar</span><span>värde ${formatKr(row.value)}</span></div>
                    <div class="tv-profit-bar"><span style="width:${Math.max(6, Math.round(row.profit / maxProfit * 100))}%"></span></div>
                </div>`).join("")
            : '<p class="tv-side-empty">Väntar på data…</p>';
    }

    function renderTvTicker(data) {
        const stats = data.stats || {};
        const weather = data.weather || {};
        const latest = (data.feed || [])[0];
        const parts = [
            `Idag: ${stats.today ?? 0} nya förfrågningar`,
            `Estimerat ordervärde idag: ${formatKr(stats.today_value_sek)}`,
            `Estimerad vinst idag: ${formatKr(stats.today_profit_sek)}`,
            `${stats.new ?? 0} ärenden väntar på hantering`,
        ];
        if (latest) parts.push(`Senast in: ${latest.customer || "Okänd kund"}${latest.boat ? ` – ${latest.boat}` : ""} (${(latest.estimate || {}).product || latest.form_type})`);
        if (weather.temperature_c != null) parts.push(`${weather.location || "Kungsbacka"} just nu: ${Math.round(weather.temperature_c)}°C, ${(weather.description || "").toLowerCase()}`);
        parts.push("Alla belopp är AI-estimat exkl. moms");
        const text = parts.map(escapeHtml).join('<i class="tv-ticker-sep">◆</i>');
        $("tv-ticker").innerHTML = `${text}<i class="tv-ticker-sep">◆</i>${text}`;
    }

    function renderTvStats(stats) {
        $("tv-stat-today").textContent = String(stats.today ?? 0);
        $("tv-stat-new").textContent = String(stats.new ?? 0);
        $("tv-stat-week").textContent = String(stats.week ?? 0);
        $("tv-stat-total").textContent = String(stats.total ?? 0);
        $("tv-stat-value").textContent = formatKr(stats.today_value_sek ?? 0);
        $("tv-stat-profit").textContent = formatKr(stats.today_profit_sek ?? 0);
    }

    async function refreshTv() {
        try {
            const response = await adminFetch("/api/ai_lab/tv");
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            const feed = Array.isArray(data.feed) ? data.feed : [];
            const ids = new Set(feed.map(item => String(item.id)));
            const freshIds = new Set();
            if (tvState.knownIds) {
                ids.forEach(id => { if (!tvState.knownIds.has(id)) freshIds.add(id); });
            }
            tvState.knownIds = ids;
            renderTvStats(data.stats || {});
            renderTvWeather(data.weather);
            renderTvFeed(feed, freshIds);
            renderTvSidePanels(feed);
            renderTvTicker(data);
            if (freshIds.size) {
                playTvChime();
                showToast(freshIds.size === 1 ? "Ny förfrågan inkommen!" : `${freshIds.size} nya förfrågningar!`);
            }
            const clock = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
            $("tv-feed-status").textContent = `Uppdaterad ${clock}`;
        } catch (error) {
            $("tv-feed-status").textContent = "Kunde inte uppdatera flödet";
        }
    }

    function startTv() {
        if (tvState.active) return;
        tvState.active = true;
        ensureTvAudio();
        tickTvClock();
        tvState.clockTimer = setInterval(tickTvClock, 1000);
        refreshTv();
        tvState.pollTimer = setInterval(refreshTv, TV_POLL_MS);
    }

    function stopTv() {
        if (!tvState.active) return;
        tvState.active = false;
        clearInterval(tvState.pollTimer);
        clearInterval(tvState.clockTimer);
        tvState.pollTimer = null;
        tvState.clockTimer = null;
    }

    function toggleTvSound() {
        tvState.soundOn = !tvState.soundOn;
        const button = $("tv-sound-toggle");
        button.textContent = tvState.soundOn ? "Ljud: På" : "Ljud: Av";
        button.setAttribute("aria-pressed", String(tvState.soundOn));
        if (tvState.soundOn) {
            ensureTvAudio();
            playTvChime();
        }
    }

    async function toggleTvFullscreen() {
        const stage = $("tv-stage");
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await stage.requestFullscreen();
                ensureTvAudio();
            }
        } catch (_) {
            showToast("Helskärm stöds inte i den här webbläsaren");
        }
    }

    function bindEvents() {
        document.querySelectorAll(".lab-nav-button").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
        document.querySelectorAll("[data-source]").forEach(button => button.addEventListener("click", () => setSourceMode(button.dataset.source)));
        document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
            state.filter = button.dataset.filter;
            document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("is-active", item === button));
            renderInbox();
        }));
        $("inbox-search").addEventListener("input", event => { state.search = event.target.value; renderInbox(); });
        $("open-manual-test").addEventListener("click", openManualWorkspace);
        $("run-selected-agent").addEventListener("click", runSelectedFromInbox);
        $("run-agent").addEventListener("click", runAgent);
        $("copy-email").addEventListener("click", copyEmail);
        $("print-quote").addEventListener("click", () => window.print());
        $("save-lab-settings").addEventListener("click", saveSettings);
        $("tv-sound-toggle").addEventListener("click", toggleTvSound);
        $("tv-fullscreen").addEventListener("click", toggleTvFullscreen);
        $("refresh-lab").addEventListener("click", async () => { await Promise.all([loadInbox(), loadSettings()]); if (tvState.active) refreshTv(); showToast("AI Lab är uppdaterat"); });
        $("mobile-nav-toggle").addEventListener("click", () => {
            document.querySelector(".lab-sidebar")?.classList.add("is-open");
            $("mobile-nav-backdrop").classList.add("is-open");
        });
        $("mobile-nav-backdrop").addEventListener("click", closeMobileNav);
    }

    async function init() {
        bindEvents();
        updateSelectedSourceSummary();
        await Promise.all([loadInbox(), loadSettings()]);
    }

    document.addEventListener("DOMContentLoaded", init);
})();
