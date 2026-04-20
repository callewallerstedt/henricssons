// Adminpanel för tillverkare och modeller
// Bygger grid och sökfält likt kapellförfrågan, men med redigering

let manufacturers = typeof boatData !== 'undefined' ? boatData : {};
let selectedManufacturerKey = null;
let selectedModelIndex = null;
let $grid1, $grid2;
let analyticsRangeDays = 30;

// Lägg in omedelbart efter globala variabler
const KNOWN_API_HOSTS = new Set(['henricssonsbatkapell.onrender.com']);
const KNOWN_STATIC_HOSTS = new Set([
    'henricssonsbatkapell.onrender.com',
    'henricssonsbatkapell.se',
    'www.henricssonsbatkapell.se'
]);

let API_BASE;
function resolveApiBase() {
    if (window.HENRICSSONS_API_BASE) {
        return String(window.HENRICSSONS_API_BASE).replace(/\/+$/, '');
    }

    if (location.protocol === 'file:') {
        return 'http://127.0.0.1:25565';
    }

    const sameOrigin = `${location.protocol}//${location.host}`;
    if (KNOWN_API_HOSTS.has(location.hostname)) {
        return sameOrigin;
    }

    if (KNOWN_STATIC_HOSTS.has(location.hostname)) {
        return sameOrigin;
    }

    if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port !== '25565') {
        return `${location.protocol}//${location.hostname}:25565`;
    }

    return sameOrigin;
}
API_BASE = resolveApiBase();

let ADMIN_API_KEY = localStorage.getItem('adminApiKey') || '';
const STATUS_FLOW = ['nya-inskick', 'vantar-pa-svar', 'i-produktion', 'redo-for-leverans'];
const STATUS_BUCKETS = [...STATUS_FLOW, 'todo'];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeHtml(html) {
    if (window.DOMPurify) {
        return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
    return escapeHtml(html);
}

const SUBMISSION_FIELD_LABELS = {
    name: 'Namn',
    email: 'E-postadress',
    phone: 'Telefonnummer',
    telefon: 'Telefonnummer',
    telefonnummer: 'Telefonnummer',
    address: 'Adress',
    adress: 'Adress',
    postal_code: 'Postnummer',
    city: 'Ort',
    ort: 'Ort',
    epost: 'E-postadress',
    e_post: 'E-postadress',
    e_postadress: 'E-postadress',
    manufacturer: 'Tillverkare',
    tillverkare: 'Tillverkare',
    model: 'Modell',
    modell: 'Modell',
    boat_brand: 'Båtmärke',
    boat_model: 'Båtmodell',
    boat_year: 'Årsmodell',
    arsmodell: 'Årsmodell',
    home_port: 'Hemmahamn',
    hemmahamn: 'Hemmahamn',
    old_canopy: 'Tillverkare av befintligt kapell',
    tillverkare_av_befintligt_kapell: 'Tillverkare av befintligt kapell',
    wants_cover: 'Önskar kapell',
    wants_fender_socks: 'Önskar fenderstrumpor',
    quantity: 'Antal',
    antal: 'Antal',
    size: 'Storlek',
    storlek: 'Storlek',
    subject: 'Ämne',
    amne: 'Ämne',
    message: 'Meddelande',
    meddelande: 'Meddelande',
    ovrig_information: 'Meddelande',
    ovriga_onskemal: 'Meddelande'
};

function normalizeSubmissionFieldKey(value) {
    return String(value || '')
        .replace(/^\d+\.\s*/, '')
        .trim()
        .toLowerCase()
        .replace(/[åä]/g, 'a')
        .replace(/ö/g, 'o')
        .replace(/[-\s]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

function getSubmissionFieldLabel(key) {
    const normalized = normalizeSubmissionFieldKey(key);
    if (SUBMISSION_FIELD_LABELS[normalized]) return SUBMISSION_FIELD_LABELS[normalized];
    return String(key || '')
        .replace(/^\d+\.\s*/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function getSubmissionField(fields, ...names) {
    if (!fields || typeof fields !== 'object') return '';
    const wanted = new Set(names.map(normalizeSubmissionFieldKey));
    for (const [key, value] of Object.entries(fields)) {
        if (wanted.has(normalizeSubmissionFieldKey(key)) && value) return value;
    }
    return '';
}

async function refreshSubmissionAttachments(item) {
    if (!item || !item.form_id) return [];
    try {
        const res = await adminFetch(`${API_BASE}/api/submission_attachments?submission_id=${encodeURIComponent(item.form_id)}`);
        if (!res.ok) return Array.isArray(item.attachments) ? item.attachments : [];
        const attachments = await res.json();
        item.attachments = Array.isArray(attachments) ? attachments : [];
        saveStatusItems();
        return item.attachments;
    } catch (err) {
        console.warn('Kunde inte ladda bilagor', err);
        return Array.isArray(item.attachments) ? item.attachments : [];
    }
}

async function adminFetch(url, options = {}) {
    const opts = { ...options };
    opts.headers = { ...(options.headers || {}) };
    const requestOrigin = new URL(url, location.href).origin;
    opts.credentials = requestOrigin === location.origin ? 'include' : 'omit';
    if (ADMIN_API_KEY) {
        opts.headers['X-Admin-Key'] = ADMIN_API_KEY;
    }
    const response = await fetch(url, opts);
    if (response.status === 401 || response.status === 403) {
        try { localStorage.removeItem('adminApiKey'); } catch (_) {}
        const loginUrl = new URL('/admin', API_BASE);
        loginUrl.searchParams.set('auth', 'required');
        window.location.href = loginUrl.toString();
        return response;
    }
    return response;
}

let attachmentImageObserver = null;

function loadAttachmentPreviewImage(img, loadingEl, url, immediate = false) {
    const startLoad = () => {
        if (img[0].dataset.loadingStarted === 'true') return;
        img[0].dataset.loadingStarted = 'true';
        adminFetch(url).then(r => r.ok ? r.blob() : null).then(blob => {
            if (!blob) throw new Error('empty attachment blob');
            const objectUrl = URL.createObjectURL(blob);
            img.attr('src', objectUrl);
            img.css('display', 'block');
            loadingEl.remove();
        }).catch(err => {
            console.warn('Kunde inte ladda bilaga', err);
            loadingEl.text('Kunde inte ladda bild').css({ color: '#b91c1c', background: '#fee2e2' });
        });
    };

    if (immediate || !('IntersectionObserver' in window)) {
        startLoad();
        return;
    }

    if (!attachmentImageObserver) {
        attachmentImageObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                attachmentImageObserver.unobserve(entry.target);
                const $img = $(entry.target);
                loadAttachmentPreviewImage($img, $img.data('loadingEl'), $img.data('attachmentUrl'), true);
            });
        }, { rootMargin: '240px 0px' });
    }

    img.data('loadingEl', loadingEl);
    img.data('attachmentUrl', url);
    attachmentImageObserver.observe(img[0]);
}

async function updateSubmissionStatusOnServer(item, status, readFlag) {
    if (!item || !item.is_form_submission || !item.form_id) return true;
    try {
        const payload = { id: item.form_id };
        if (status) payload.status = status;
        if (typeof readFlag === 'boolean') payload.read = readFlag;
        const res = await adminFetch(`${API_BASE}/api/update_submission_status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return res.ok;
    } catch (_) {
        return false;
    }
}

async function deleteSubmissionOnServer(item) {
    if (!item || !item.is_form_submission || !item.form_id) return false;
    try {
        const res = await adminFetch(`${API_BASE}/api/delete_submission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.form_id })
        });
        if (!res.ok) return false;
        const data = await res.json();
        return Boolean(data && data.success);
    } catch (_) {
        return false;
    }
}

async function updateSubmissionNotesOnServer(item, notes) {
    if (!item || !item.is_form_submission || !item.form_id) return false;
    try {
        const res = await adminFetch(`${API_BASE}/api/update_submission_notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: item.form_id,
                notes: notes
            })
        });
        return res.ok;
    } catch (err) {
        console.error('Kunde inte spara anteckningar', err);
        return false;
    }
}

function removeSubmissionFromAllStatuses(formId) {
    if (!formId) return false;
    let removed = false;
    Object.keys(statusItems).forEach(status => {
        const list = statusItems[status] || [];
        const idx = list.findIndex(item => item && item.form_id === formId);
        if (idx >= 0) {
            list.splice(idx, 1);
            removed = true;
        }
    });
    return removed;
}

function getNextStatus(status) {
    const idx = STATUS_FLOW.indexOf(status);
    if (idx < 0 || idx === STATUS_FLOW.length - 1) return null;
    return STATUS_FLOW[idx + 1];
}

// ----------------------------- Tab & Extras logic -----------------------------
const extrasCategories = {
    all: 'Visa alla',
    motorboats: 'Motorbåtar',
    sailboats: 'Segelbåtar',
    boatseats: 'Båtstolar & Dynor',
    otherfabrics: 'Vävprover övriga',
    special: 'Specialsömnad & Skräddarsytt',
    sunbrella: 'Sunbrella Plus Kollektion'
};
let extrasData = {};
let activeTab = 'dashboard';
let activeExtrasKey = null;
let selectedExtraIndex = null;
let editExtrasCat = null; // håller vilken kategori som redigeras när vi är i "Visa alla"
let extrasLoaded = false;
let extrasLoadingPromise = null;
let fullCalendarLoadingPromise = null;

// Dashboard variables
let calendar = null;
let statusItems = {
    'nya-inskick': [],
    'vantar-pa-svar': [],
    'i-produktion': [],
    'redo-for-leverans': [],
    'todo': []
};
let nyaInskickSortOrder = 'newest'; // 'newest' or 'oldest'
let currentFormFilter = 'all'; // 'all', 'Kapellförfrågan', 'Fenderförfrågan', 'Dynsatsförfrågan', 'Kontakt'
let chatbotPrompt = 'Du är en hjälpsam assistent för Henricssons Båtkapell. Du hjälper till med frågor om båtkapell, beställningar och allmän service.';
let currentEditingItem = null;
let statusFoldersLoading = false;
function getAdvancedGreeting(language = 'sv') {
    return language === 'en'
        ? 'Hello! What do you need help with today?'
        : 'Hej! Vad behöver du hjälp med idag?';
}

function createAdvancedChatState(language = 'sv') {
    return {
        intent: '',
        draft: {},
        readyToSubmit: false,
        needsConfirmation: false,
        summary: '',
        confirmed: false,
        language,
        isTyping: false,
        isSubmitting: false,
        history: [{ role: 'assistant', content: getAdvancedGreeting(language) }]
    };
}

const ADVANCED_SUMMARY_FIELD_ORDER = {
    Kapellforfragan: ['name', 'phone', 'email', 'manufacturer', 'model', 'boat_year', 'home_port', 'old_canopy', 'message'],
    Fenderforfragan: ['name', 'phone', 'email', 'address', 'quantity', 'size'],
    Kontakt: ['name', 'email', 'phone', 'subject', 'message']
};

const ADVANCED_SUMMARY_FIELD_LABELS = {
    sv: {
        name: 'Namn',
        phone: 'Telefonnummer',
        email: 'E-postadress',
        manufacturer: 'Tillverkare',
        model: 'Modell',
        boat_year: 'Arsmodell',
        home_port: 'Hemmahamn',
        old_canopy: 'Tillverkare av befintligt kapell',
        message: 'Meddelande',
        quantity: 'Antal',
        size: 'Storlek',
        address: 'Adress',
        subject: 'Amne'
    },
    en: {
        name: 'Name',
        phone: 'Phone number',
        email: 'Email',
        manufacturer: 'Manufacturer',
        model: 'Model',
        boat_year: 'Year model',
        home_port: 'Home port',
        old_canopy: 'Current canopy manufacturer',
        message: 'Message',
        quantity: 'Quantity',
        size: 'Size',
        address: 'Address',
        subject: 'Subject'
    }
};

let advancedChatState = createAdvancedChatState('sv');

// -----------------------------
// UNSAVED INDICATOR
// -----------------------------
const unsavedState = { edit: false, extras: false };
function setUnsaved(target, flag){
    const id = target==='extras' ? '#extras-unsaved' : '#edit-unsaved';
    unsavedState[target]=flag;
    if(flag){
        if(!$(id).length){
            const span=$('<span>').attr('id', id.substring(1)).addClass('unsaved-indicator').text(' Ej sparat*');
            if(target==='extras'){
                $('#extras-edit-section h2:first').append(span);
            } else {
                $('#edit-section h2:first').append(span);
            }
        }
    } else {
        $(id).remove();
    }
}

function fetchManufacturers() {
    // Försök alltid hämta senaste data från servern
    return fetch(`${API_BASE}/boat_data.json?v=${Date.now()}`)
        .then(r => {
            if(!r.ok) throw new Error('Status ' + r.status);
            return r.json();
        })
        .then(json => {
            manufacturers = json || {};
            try { localStorage.setItem('boatData', JSON.stringify(manufacturers)); } catch(_){}
            buildGrids();
        })
        .catch(err => {
            console.warn('Kunde inte hämta boat_data.json från API - använder ev. localStorage', err);
            try {
                const stored = localStorage.getItem('boatData');
                if(stored){ manufacturers = JSON.parse(stored); }
            } catch(e){ console.error('Fel vid parsa localStorage boatData', e); }
            buildGrids();
        });
}

function fetchExtras() {
    // Ladda allt direkt från models_meta.json och mappa till extrasData-strukturen
    const url = `${API_BASE}/henricssons_bilder/models_meta.json?v=${Date.now()}`;
    return fetch(url)
        .then(r => {
            if (!r.ok) {
                throw new Error('HTTP error! status: ' + r.status);
            }
            return r.json();
        })
        .then(meta => {
            // Initiera tomma listor per kategori
            extrasData = {
                all: [],
                motorboats: [],
                sailboats: [],
                boatseats: [],
                otherfabrics: [],
                special: [],
                sunbrella: []
            };
            const catMap = {
                'Motorbåtar': 'motorboats',
                'Segelbåtar': 'sailboats',
                'Båtstolar & Dynor': 'boatseats',
                'Vävprover övriga': 'otherfabrics',
                'Specialsömnad & Skräddarsytt': 'special',
                'Sunbrella Plus Kollektion vävprover': 'sunbrella'
            };
            Object.entries(meta).forEach(([slug, item]) => {
                const key = catMap[item.category] || 'motorboats';
                extrasData[key].push({
                    slug,
                    name: item.model,
                    manufacturer: item.manufacturer,
                    variant: item.variant,
                    description: item.description,
                    delivery: item.delivery,
                    images: (item.images || []).map(img => {
                        if(img.startsWith('data:') || img.startsWith('http')) return img;
                        const clean = img.replace(/^henricssons_bilder[\\/]/,'').replace(/\\/g,'/');
                        return `${API_BASE}/henricssons_bilder/` + clean;
                    }),
                    source: item.source,
                    published: item.hasOwnProperty('published') ? item.published : true
                });
            });

            // Bygg sammanlagd lista
            extrasData.all = [].concat(
                extrasData.motorboats,
                extrasData.sailboats,
                extrasData.boatseats,
                extrasData.otherfabrics,
                extrasData.special,
                extrasData.sunbrella
            );
            extrasLoaded = true;
        })
        .catch(err => {
            console.error('Could not load models_meta.json', err);
            console.error('Error details:', err.message);
            extrasData = {};
        });
}

function ensureExtrasLoaded() {
    if (extrasLoaded) return Promise.resolve();
    if (extrasLoadingPromise) return extrasLoadingPromise;
    extrasLoadingPromise = fetchExtras().finally(() => {
        extrasLoadingPromise = null;
    });
    return extrasLoadingPromise;
}

function loadScriptOnce(src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve();
    const existing = document.querySelector(`script[data-dynamic-src="${src}"]`);
    if (existing) {
        return new Promise((resolve, reject) => {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
        });
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.dataset.dynamicSrc = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function loadStyleOnce(href) {
    if (document.querySelector(`link[data-dynamic-href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.dynamicHref = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
    });
}

function ensureFullCalendarLoaded() {
    if (window.FullCalendar) return Promise.resolve();
    if (!fullCalendarLoadingPromise) {
        fullCalendarLoadingPromise = Promise.all([
            loadStyleOnce('https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/main.min.css'),
            loadScriptOnce('https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js', 'FullCalendar')
        ]);
    }
    return fullCalendarLoadingPromise;
}

function buildGrids() {
    const grid1 = $('.grid1');
    const grid2 = $('.grid2');
    grid1.empty();
    grid2.empty();
    // Sort manufacturers by display name for grid1
    const sortedKeys = Object.keys(manufacturers).sort((a, b) => {
        const nameA = manufacturers[a].name || '';
        const nameB = manufacturers[b].name || '';
        return nameA.localeCompare(nameB, 'sv', { sensitivity: 'base' });
    });
    sortedKeys.forEach(key => {
        const manufacturer = manufacturers[key];
        const item = $(`<div class="grid1-item ${key === selectedManufacturerKey ? 'selected-t' : ''}" data-key="${key}">${manufacturer.name}</div>`);
        grid1.append(item);
    });
    if (selectedManufacturerKey && manufacturers[selectedManufacturerKey]) {
        // Sort models alphabetically for display
        const sortedModels = [...manufacturers[selectedManufacturerKey].models].sort((a, b) => getModelName(a).localeCompare(getModelName(b), 'sv', { sensitivity: 'base' }));
        sortedModels.forEach(model => {
            const origIdx = manufacturers[selectedManufacturerKey].models.indexOf(model);
            const item = $(`<div class="grid2-item" data-index="${origIdx}">${getModelName(model)}</div>`);
            grid2.append(item);
        });
    }
    $grid1 = grid1.isotope({ itemSelector: '.grid1-item', layoutMode: 'fitRows', filter: '*' });
    // Ingen Isotope på grid2 - vi behåller vanlig flex-layout så redigeringsrutan inte överlappas
    bindGridEvents();
}

function buildModels() {
    const grid2 = $('.grid2');
    grid2.empty();
    if (!selectedManufacturerKey || !manufacturers[selectedManufacturerKey]) return;
    const manuModels = manufacturers[selectedManufacturerKey].models;
    // Sort using model names regardless of representation
    const sortedModels = [...manuModels].sort((a, b) => getModelName(a).localeCompare(getModelName(b), 'sv', { sensitivity: 'base' }));
    sortedModels.forEach(model => {
        const origIdx = manuModels.indexOf(model);
        const item = $(`<div class="grid2-item ${origIdx === selectedModelIndex ? 'selected-m' : ''}" data-index="${origIdx}">${getModelName(model)}</div>`);
        grid2.append(item);
    });
    bindGridEvents(); // bind click on new model buttons
}

function bindGridEvents() {
    // Tillverkare
    $('.grid1-item').off('click').on('click', function() {
        $('.grid1-item').removeClass('selected-t');
        $(this).addClass('selected-t');
        selectedManufacturerKey = $(this).data('key');
        selectedModelIndex = null;
        buildModels();
        showEditSection();
    });
    // Modell
    $('.grid2-item').off('click').on('click', function(e) {
        $('.grid2-item').removeClass('selected-m');
        $(this).addClass('selected-m');
        selectedModelIndex = $(this).data('index');
        showEditSection();
        e.stopPropagation();
    });
}

function showEditSection() {
    $('#edit-section').show();
    $('#edit-section').addClass('editing');
    if (selectedManufacturerKey !== null && selectedManufacturerKey !== undefined) {
        if (selectedModelIndex !== null) {
            showModelEdit();
        } else {
            showManufacturerEdit();
        }
    } else {
        // Ingen tillverkare vald
        $('#edit-section').html('<h2>Redigering</h2><p>Välj en tillverkare för att börja.</p>').hide();
    }

    // Ingen automatisk scroll på mobil ? låt användaren bläddra själv för att undvika glitch
}

function showManufacturerEdit() {
    const manu = manufacturers[selectedManufacturerKey];
    const safeManufacturerName = escapeHtml(manu.name || '');
    $('#edit-section').html(`
        <h2>Redigera tillverkare</h2>
        <label>Tillverkarnamn</label>
        <input type="text" id="edit-manu-name" value="${safeManufacturerName}" />
        <button class="btn" id="save-manu-btn">Spara</button>
        <button class="btn btn-danger" id="delete-manu-btn">Ta bort</button>
        <button class="btn btn-secondary" id="cancel-manu-btn">Avbryt</button>
        <div id="edit-msg"></div>
    `);

    // Reset unsaved indicator and bind change
    setUnsaved('edit', false);
    $('#edit-manu-name').on('input', ()=> setUnsaved('edit', true));

    $('#save-manu-btn').on('click', function(){
        const newName = $('#edit-manu-name').val().trim();
        if(!newName) return showEditMsg('Namn krävs','error');
        manu.name = newName;
        saveManufacturer(selectedManufacturerKey, manu, ()=>{
            showEditMsg('Tillverkare sparad!','success');
            setUnsaved('edit', false);
            buildGrids(); // Behöver bygga om hela griden för tillverkarnamn
            showEditSection();
        });
    });

    $('#delete-manu-btn').on('click', function(){
        if(!confirm('Ta bort denna tillverkare?')) return;
        const keyToDelete = selectedManufacturerKey;
        deleteManufacturer(selectedManufacturerKey, ()=>{
            selectedManufacturerKey=null;
            selectedModelIndex=null;
            // Ta bort tillverkaren från UI utan att bygga om
            $(`.grid1-item[data-key="${keyToDelete}"]`).remove();
            $('.grid2').empty();
            $('#edit-section').removeClass('editing').html('<h2>Redigering</h2><p>Välj en tillverkare för att börja.</p>').hide();
        });
    });

    $('#cancel-manu-btn').on('click', function(){
        selectedManufacturerKey=null;
        selectedModelIndex=null;
        $('.grid1-item').removeClass('selected-t');
        $('.grid2-item').removeClass('selected-m');
        $('#edit-section').removeClass('editing').html('<h2>Redigering</h2><p>Välj en tillverkare för att börja.</p>').hide();
        $('.grid2').empty(); // Rensa modellistan
    });
}

function showModelEdit() {
    const manu = manufacturers[selectedManufacturerKey];
    const modelObj = manu.models[selectedModelIndex];
    const modelName = getModelName(modelObj);
    const safeModelName = escapeHtml(modelName || '');
    ensureModelObject(selectedModelIndex);
    
    $('#edit-section').html(`
        <h2>Redigera modell</h2>
        <label>Modellnamn</label>
        <input type="text" id="edit-model-name" value="${safeModelName}" />
        <button class="btn" id="save-model-btn">Spara</button>
        <button class="btn btn-danger" id="delete-model-btn">Ta bort</button>
        <button class="btn btn-secondary" id="cancel-model-btn">Avbryt</button>
        <div id="edit-msg"></div>
    `);
    
    // Reset unsaved indicator and bind change
    setUnsaved('edit', false);
    $('#edit-model-name').on('input', ()=> setUnsaved('edit', true));

    $('#save-model-btn').on('click', function() {
        const newName = $('#edit-model-name').val().trim();
        if (!newName) return showEditMsg('Namn krävs', 'error');
        setModelName(selectedModelIndex, newName);
        saveManufacturer(selectedManufacturerKey, manu, () => {
            showEditMsg('Modell sparad!', 'success');
            setUnsaved('edit', false);
            buildModels();
        });
    });
    
    $('#delete-model-btn').on('click', function() {
        if (!confirm('Ta bort denna modell?')) return;
        manu.models.splice(selectedModelIndex, 1);
        saveManufacturer(selectedManufacturerKey, manu, () => {
            showEditMsg('Modell borttagen!', 'success');
            setUnsaved('edit', false);
            selectedModelIndex = null;
            buildModels();
            showEditSection();
        });
    });
    
    $('#cancel-model-btn').on('click', function() {
        selectedModelIndex = null;
        $('.grid2-item').removeClass('selected-m');
        $('#edit-section').removeClass('editing');
        // Visa tillverkare-redigering istället för att bygga om
        showManufacturerEdit();
    });
}

function showEditMsg(msg, type) {
    $('#edit-msg').empty().append($('<div>').addClass(type).text(msg));
    setTimeout(() => { $('#edit-msg').empty(); }, 2000);
}

function pushFullDataset(cb) {
    // Spara i localStorage och skicka till server
    try {
        localStorage.setItem('boatData', JSON.stringify(manufacturers));

        // Skicka till Python-server
        adminFetch(`${API_BASE}/api/save_boatdata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(manufacturers)
        })
        .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(data => {
            if (!data.success) {
                showEditMsg('Kunde inte spara till fil: ' + (data.error || 'Okant fel'), 'error');
            }
            cb && cb();
        })
        .catch(() => {
            showEditMsg('Kunde inte ansluta till server. Kontrollera admin-nyckel och server.', 'error');
            cb && cb();
        });

    } catch (e) {
        showEditMsg('Kunde inte spara', 'error');
        cb && cb();
    }
}

function saveManufacturer(key, manu, cb) {
    manufacturers[key] = manu;
    pushFullDataset(cb);
}

function deleteManufacturer(key, cb) {
    delete manufacturers[key];
    pushFullDataset(cb);
}

// Helper to get model name regardless of representation
function getModelName(model) {
    return typeof model === 'string' ? model : (model && model.name ? model.name : '');
}

function setModelName(index, newName) {
    const m = manufacturers[selectedManufacturerKey].models[index];
    if (typeof m === 'string') {
        manufacturers[selectedManufacturerKey].models[index] = newName;
    } else if (m) {
        m.name = newName;
    }
}

function ensureModelObject(index) {
    let m = manufacturers[selectedManufacturerKey].models[index];
    if (typeof m === 'string') {
        m = { name: m };
        manufacturers[selectedManufacturerKey].models[index] = m;
    }
    // Lägg till saknade fält
    if (!m.images) m.images = [];
    if (m.description === undefined) m.description = '';
    if (m.variant === undefined) m.variant = '';
    if (m.delivery === undefined) m.delivery = '';
    if (m.category === undefined) m.category = 'Kapell - Motorbåt';
}

function bindImageDelete() {
    $('.del-img-btn').off('click').on('click', function() {
        const imgIdx = $(this).data('idx');
        if (!confirm('Ta bort denna bild?')) return;
        manufacturers[selectedManufacturerKey].models[selectedModelIndex].images.splice(imgIdx, 1);
        saveManufacturer(selectedManufacturerKey, manufacturers[selectedManufacturerKey], () => {
            showEditMsg('Bild borttagen', 'success');
            showEditSection();
        });
    });
}

function formatAnalyticsNumber(value) {
    return new Intl.NumberFormat('sv-SE').format(Number(value || 0));
}

function renderAnalyticsBarList(targetSelector, items, labelKey, emptyLabel) {
    const target = $(targetSelector);
    target.empty();
    if (!Array.isArray(items) || !items.length) {
        target.html(`<div class="analytics-empty">${emptyLabel}</div>`);
        return;
    }
    const maxCount = Math.max(...items.map(item => Number(item.count || 0)), 1);
    items.forEach(item => {
        const label = escapeHtml(item[labelKey] || '-');
        const count = Number(item.count || 0);
        const width = Math.max(6, Math.round((count / maxCount) * 100));
        target.append(`
            <div class="analytics-bar-item">
                <div class="analytics-bar-top">
                    <strong title="${label}">${label}</strong>
                    <span>${formatAnalyticsNumber(count)}</span>
                </div>
                <div class="analytics-bar-track">
                    <div class="analytics-bar-fill" style="width:${width}%;"></div>
                </div>
            </div>
        `);
    });
}

function renderAnalyticsChart(days) {
    const target = $('#analytics-daily-chart');
    target.empty();
    if (!Array.isArray(days) || !days.length) {
        target.html('<div class="analytics-empty">Ingen data ännu.</div>');
        return;
    }
    const maxViews = Math.max(...days.map(day => Number(day.pageviews || 0)), 1);
    const maxSearches = Math.max(...days.map(day => Number(day.searches || 0)), 1);
    days.forEach(day => {
        const pageviews = Number(day.pageviews || 0);
        const searches = Number(day.searches || 0);
        const dateLabel = String(day.date || '').slice(5);
        const pageHeight = Math.max(pageviews ? 8 : 2, Math.round((pageviews / maxViews) * 120));
        const searchHeight = Math.max(searches ? 8 : 2, Math.round((searches / maxSearches) * 70));
        const tooltip = escapeHtml(
            `${String(day.date || '')}\n${formatAnalyticsNumber(pageviews)} sidvisningar\n${formatAnalyticsNumber(searches)} sökningar`
        ).replace(/\n/g, '&#10;');
        target.append(`
            <div class="analytics-chart-col" tabindex="0" data-tooltip="${tooltip}">
                <div class="analytics-chart-bars">
                    <div class="analytics-chart-bar" style="height:${pageHeight}px;"></div>
                    <div class="analytics-chart-bar is-search" style="height:${searchHeight}px;"></div>
                </div>
                <div class="analytics-chart-label">${escapeHtml(dateLabel)}</div>
            </div>
        `);
    });
}

async function loadAnalyticsSummary(days = analyticsRangeDays) {
    analyticsRangeDays = Number(days || 30);
    $('.analytics-range-btn').removeClass('active');
    $(`.analytics-range-btn[data-days="${analyticsRangeDays}"]`).addClass('active');
    $('#analytics-daily-chart').html('<div class="analytics-empty">Laddar...</div>');
    $('#analytics-top-pages').empty();
    $('#analytics-top-searches').empty();
    $('#analytics-top-referrers').empty();
    try {
        const res = await adminFetch(`${API_BASE}/api/analytics/summary?days=${encodeURIComponent(analyticsRangeDays)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        $('#analytics-total-pageviews').text(formatAnalyticsNumber(data?.totals?.pageviews));
        $('#analytics-total-searches').text(formatAnalyticsNumber(data?.totals?.searches));
        renderAnalyticsChart(data?.daily || []);
        renderAnalyticsBarList('#analytics-top-pages', data?.top_pages || [], 'path', 'Inga sidvisningar ännu.');
        renderAnalyticsBarList('#analytics-top-searches', data?.top_searches || [], 'query', 'Inga sökningar ännu.');
        renderAnalyticsBarList('#analytics-top-referrers', data?.top_referrers || [], 'host', 'Inga externa trafikkällor ännu.');
    } catch (err) {
        console.error('Kunde inte ladda analytics', err);
        $('#analytics-total-pageviews').text('0');
        $('#analytics-total-searches').text('0');
        $('#analytics-daily-chart').html('<div class="analytics-empty">Kunde inte ladda statistik.</div>');
        $('#analytics-top-pages').html('<div class="analytics-empty">Kunde inte ladda statistik.</div>');
        $('#analytics-top-searches').html('<div class="analytics-empty">Kunde inte ladda statistik.</div>');
        $('#analytics-top-referrers').html('<div class="analytics-empty">Kunde inte ladda statistik.</div>');
    }
}

function switchTab(tab){
    activeTab = tab;
    $('.tab-btn').removeClass('active');
    $(`.tab-btn[data-tab="${tab}"]`).addClass('active');
    $('#settings-section').removeClass('active');
    $('#analytics-section').removeClass('active');

    if(tab==='dashboard'){
        $('#dashboard-section').addClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        initDashboard();
    } else if(tab==='texts'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').addClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadAnnouncementText();
        // Set up real-time preview update
        $('#announcement-text').off('input keyup').on('input keyup', function() {
            updateAnnouncementPreview();
        });
    } else if(tab==='advanced'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').addClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadAiSettings();
        initAdvancedTestChat();
    } else if(tab==='settings'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#settings-section').addClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadMailgunSettings();
    } else if(tab==='calendar'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').addClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        initCalendar();
    } else if(tab==='analytics'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        $('#analytics-section').addClass('active');
        loadAnalyticsSummary(analyticsRangeDays);
    } else if(tab==='boats'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').show();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('.quicksearch').show();
        // Dölj sekundära flikar när vi är i tillverkar-läget
        $('#admin-tabs').hide();
        // Tvinga om-layout av Isotope om den redan initierats för att fixa fastnad animation
        if($grid1 && typeof $grid1.isotope === 'function') {
            $grid1.isotope('layout');
        }
        $('#extras-search').hide();
        editExtrasCat = null; // nollställ
    } else if(tab==='tempproducts'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').show();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadTempProducts();
    } else {
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').show();
        $('#tempproducts-section').hide();
        $('.quicksearch').hide();
        // Visa sekundära flikar under "Bilder & exempel"
        $('#admin-tabs').css('display', 'flex');
        $('#extras-search').show();
        activeExtrasKey = tab;
        selectedExtraIndex = null;
        editExtrasCat = null;
        $('.grid-extras').html('<div class="folder-loading-state"><span class="folder-loading-spinner" aria-hidden="true"></span><span>Laddar...</span></div>');
        $('#extras-edit-section').show().addClass('editing').html('<h2>Redigera bild/exempel</h2><p>Laddar poster...</p>');
        ensureExtrasLoaded().then(() => {
            if (activeExtrasKey !== tab) return;
            buildExtrasList();
            showExtrasEdit();
        });
    }
}

function buildExtrasList(){
    if(!extrasData[activeExtrasKey]) extrasData[activeExtrasKey]=[];
    const list = $('.grid-extras');
    list.empty();
    let pairs = [];
    if(activeExtrasKey==='all'){
        // Kombinera och märk upp vilken kategori de hör till
        Object.keys(extrasData).forEach(cat=>{
            if(cat==='all') return;
            extrasData[cat].forEach((obj,i)=> pairs.push({obj, idx:i, cat}));
        });
    } else {
        pairs = extrasData[activeExtrasKey].map((obj,i)=>({obj, idx:i, cat:activeExtrasKey}));
    }
    // Skapa par (obj, originalIndex, cat) så att klick hamnar rätt även efter sortering
    pairs.sort((a,b)=> (a.obj.name||'').localeCompare(b.obj.name||'', 'sv',{sensitivity:'base'}));
    pairs.forEach(({obj, idx, cat})=>{
        const searchStr = `${obj.name||''} ${obj.manufacturer||''} ${obj.model||''} ${obj.variant||''}`.toLowerCase();
        const isSelected = idx===selectedExtraIndex && (activeExtrasKey==='all'?cat===editExtrasCat:cat===activeExtrasKey);
        const inactiveCls = obj.published===false ? 'inactive' : '';
        const noImagesCls = (!obj.images || obj.images.length === 0) ? 'no-images' : '';
        const safeName = escapeHtml(obj.name || '-');
        const div = $(`<div class="extras-item ${inactiveCls} ${noImagesCls} ${isSelected?'selected-e':''}" data-index="${idx}" data-cat="${cat}" data-search="${searchStr}"><span class="extra-name">${safeName}</span></div>`);
        list.append(div);
    });

    const headingText = extrasCategories[activeExtrasKey] || 'Poster';
    const plusBtn = activeExtrasKey==='all' ? '' : ' <button class="add-btn" id="add-extra-btn">+</button>';
    $('#extras-heading').html(`${headingText}${plusBtn}`);

    // Bind clicks
    $('.extras-item').off('click').on('click', function(){
        const cat = $(this).data('cat');
        const idx = $(this).data('index');
        if(activeExtrasKey==='all'){
            editExtrasCat = cat; // kom ihåg var posten hör hemma
            $('.extras-item').removeClass('selected-e');
            $(this).addClass('selected-e');
            selectedExtraIndex = idx;
            showExtrasEdit();
        } else {
            $('.extras-item').removeClass('selected-e');
            $(this).addClass('selected-e');
            selectedExtraIndex = idx;
            showExtrasEdit();
        }
    });
    $('#add-extra-btn').off('click').on('click', function(){
        if(activeExtrasKey==='all') return; // disable add in aggregated view
        extrasData[activeExtrasKey].push({name:'Ny post', manufacturer:'', model:'', variant:'', description:'', delivery:'', images:[]});
        selectedExtraIndex = extrasData[activeExtrasKey].length-1;
        buildExtrasList();
        showExtrasEdit();
    });
}

function showExtrasEdit() {
    $('#extras-edit-section').show();
    $('#extras-edit-section').addClass('editing');
    if (selectedExtraIndex === null) {
        $('#extras-edit-section').html('<h2>Redigera bild/exempel</h2><p>Välj en post för att redigera</p>');
        return;
    }
    
    const catKey = activeExtrasKey === 'all' ? editExtrasCat : activeExtrasKey;
    const obj = extrasData[catKey][selectedExtraIndex];
    const safeName = escapeHtml(obj.name||'');
    const safeManufacturer = escapeHtml(obj.manufacturer||'');
    const safeModel = escapeHtml(obj.model||'');
    const safeVariant = escapeHtml(obj.variant||'');
    const safeDescription = escapeHtml(obj.description||'');
    const safeDelivery = escapeHtml(obj.delivery||'');
    $('#extras-edit-section').html(`
        <h2>Redigera post</h2>
        <label>Namn</label>
        <input type="text" id="extra-name" value="${safeName}" />
        <div style="display:flex;flex-direction:column;gap:0rem;"> 
            <span style="color:#0a2342;font-weight:bold;">Publicerad</span>
            <label class="switch" style="align-self:flex-start;"><input type="checkbox" id="extra-published" ${obj.published!==false?'checked':''}><span class="slider"></span></label>
        </div>
        <label>Tillverkare</label>
        <input type="text" id="extra-manu" value="${safeManufacturer}" />
        <label>Modell</label>
        <input type="text" id="extra-model" value="${safeModel}" />
        <label>Variant</label>
        <input type="text" id="extra-variant" value="${safeVariant}" />
        <label>Beskrivning</label>
        <textarea id="extra-desc" rows="3">${safeDescription}</textarea>
        <label>Leveransinfo</label>
        <textarea id="extra-delivery" rows="2">${safeDelivery}</textarea>
        <label>Bilder</label>
        <div id="extra-images-list" class="img-thumb-list">
            ${(obj.images||[]).map((img,idx)=>`<div class="img-thumb" data-idx="${idx}" style="${idx===0?'border:2px solid #28a745;':''}"><img src="${escapeHtml(img)}" alt=""/><button class="set-thumb-btn" title="Gör thumbnail" data-idx="${idx}" style="background:#28a745;color:#fff;position:absolute;top:2px;left:2px;border:none;border-radius:3px;padding:0 4px;cursor:pointer;">★</button><button class="del-img-btn" data-idx="${idx}" style="position:absolute;top:2px;right:2px;">&times;</button></div>`).join('')}
        </div>
        <input type="file" id="upload-extra-img" accept="image/*" />
        <button class="btn" id="save-extra-btn">Spara</button>
        <button class="btn btn-danger" id="delete-extra-btn">Ta bort</button>
        <button class="btn btn-secondary" id="cancel-extra-btn">Avbryt</button>
        <div id="extras-msg"></div>
    `);

    function extrasMsg(t, cls){
        $('#extras-msg').empty().append($('<div>').addClass(cls).text(t));
        setTimeout(()=>$('#extras-msg').empty(),2000);
    }

    // Reset unsaved indicator and bind change
    setUnsaved('extras', false);
    $('#extra-name, #extra-manu, #extra-model, #extra-variant, #extra-desc, #extra-delivery').on('input', ()=> setUnsaved('extras', true));
    $('#extra-published').on('change', function(){
        obj.published = $(this).is(':checked');
        const item = $('.extras-item.selected-e');
        if(obj.published===false){ item.addClass('inactive'); } else { item.removeClass('inactive'); }
        setUnsaved('extras', true);
    });

    $('#save-extra-btn').on('click', function(){
        if(!obj.images) obj.images = obj.images || [];
        obj.name = $('#extra-name').val().trim();
        obj.manufacturer = $('#extra-manu').val().trim();
        obj.model = $('#extra-model').val().trim();
        obj.variant = $('#extra-variant').val().trim();
        obj.description = $('#extra-desc').val().trim();
        obj.delivery = $('#extra-delivery').val().trim();
        obj.published = $('#extra-published').is(':checked');
        // Spara och uppdatera både listan & redigeringsrutan direkt
        saveExtras(()=>{
            extrasMsg('Post sparad!','success');
            setUnsaved('extras', false);
            // Uppdatera endast listans synlighet och namn utan att förstöra selektionen
            const updatedObj = extrasData[catKey][selectedExtraIndex];
            $(`.extras-item.selected-e .extra-name`).text(updatedObj.name || '?');
            // Behåll formuläret som det är - användaren ser sina ändringar direkt
        });
    });
    $('#delete-extra-btn').on('click', function(){
        if(!confirm('Ta bort?')) return;
        extrasData[catKey].splice(selectedExtraIndex,1);
        selectedExtraIndex=null;
        saveExtras(()=>{ buildExtrasList(); showExtrasEdit(); });
    });
    $('#cancel-extra-btn').on('click', function(){
        selectedExtraIndex=null;
        $('.extras-item').removeClass('selected-e');
        showExtrasEdit();
    });

    // Bilduppladdning
    $('#upload-extra-img').off('change').on('change', function(){
        const file=this.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload=function(e){
            // Ladda upp till servern
            const slug = obj.slug || (obj.name||'').toLowerCase().replace(/[^a-z0-9]+/gi,'-').replace(/(^-|-$)/g,'');
            const catFolderMap = {
                motorboats: 'motorbatar',
                sailboats: 'segelbatar',
                boatseats: 'batstolar-dynor',
                otherfabrics: 'vavprover-ovriga',
                special: 'specialsomnad-skraddarsytt',
                sunbrella: 'sunbrella-plus-kollektion-vavprover'
            };
            const folder = catFolderMap[catKey] || 'motorbatar';
            const fileExt = file.name.split('.').pop();
            const nextIdx = (obj.images||[]).length + 1;
            const fileName = `${slug}_${String(nextIdx).padStart(2,'0')}.${fileExt}`;
            const relPath = `${folder}/${slug}/${fileName}`;

            adminFetch(`${API_BASE}/api/upload_image`, {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({data:e.target.result, rel_path:relPath})
            }).then(r=>r.json()).then(resp=>{
                if(resp.success){
                    if(!obj.images) obj.images=[];
                    obj.images.push(resp.saved_path);
                    saveExtras(()=>{
                        const idx=obj.images.length-1;
                        const previewPath=`${API_BASE}/henricssons_bilder/`+resp.saved_path.replace(/^henricssons_bilder[\\/]/,'').replace(/\\/g,'/');
                        $('#extra-images-list').append(`<div class="img-thumb" data-idx="${idx}"><img src="${previewPath}" alt=""/><button class="set-thumb-btn" title="Gör thumbnail" data-idx="${idx}" style="background:#28a745;color:#fff;position:absolute;top:2px;left:2px;border:none;border-radius:3px;padding:0 4px;cursor:pointer;">★</button><button class="del-img-btn" data-idx="${idx}">&times;</button></div>`);
                        $('.extras-item.selected-e').removeClass('no-images');
                        $('#extras-edit-section .no-image-indicator, #extras-edit-section .bilderex-no-image').remove();
                        bindExtraImageDelete();
                        bindSetThumbnail();
                        setUnsaved('extras', false);
                    });
                } else {
                    alert('Kunde inte spara bild: '+ (resp.error||'okänt fel'));
                }
            }).catch(err=>{
                alert('Kunde inte ansluta till servern för bilduppladdning');
            });
        };
        reader.readAsDataURL(file);
    });
    bindExtraImageDelete();
    bindSetThumbnail();
}

function saveExtras(cb){
    // Konvertera till models_meta-format
    const catReverse = {
        motorboats: 'Motorbåtar',
        sailboats: 'Segelbåtar',
        boatseats: 'Båtstolar & Dynor',
        otherfabrics: 'Vävprover övriga',
        special: 'Specialsömnad & Skräddarsytt',
        sunbrella: 'Sunbrella Plus Kollektion vävprover'
    };

    // Bygg nytt meta-objekt
    const newMeta = {};
    Object.entries(extrasData).forEach(([key, arr]) => {
        arr.forEach(obj => {
            const slug = obj.slug || (obj.name||'').toLowerCase().replace(/[^a-z0-9]+/gi,'-').replace(/(^-|-$)/g,'');
            const relImgs = (obj.images||[]).map(p => {
                if(p.startsWith('data:')) return p;
                return p.replace(/^henricssons_bilder\//,'').replace(/\//g,'\\');
            });
            newMeta[slug] = {
                manufacturer: obj.manufacturer || '',
                model: obj.name || obj.model || '',
                description: obj.description || '',
                variant: obj.variant || '',
                delivery: obj.delivery || '',
                category: catReverse[key] || 'Motorbåtar',
                images: relImgs,
                source: obj.source || '',
                published: obj.published!==false
            };
        });
    });

    adminFetch(`${API_BASE}/api/save_models_meta`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(newMeta)
    })
    .then(response => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showEditMsg('Extras sparade!', 'success');
            setUnsaved('extras', false);
        } else {
            showEditMsg('Kunde inte spara till fil: ' + (data.error || 'Okant fel'), 'error');
        }
        cb && cb();
    })
    .catch(() => {
        showEditMsg('Kunde inte ansluta till server. Kontrollera admin-nyckel och server.', 'error');
        cb && cb();
    });
}

function bindExtraImageDelete(){
    $('#extra-images-list .del-img-btn').off('click').on('click', function(){
        const imgIdx=$(this).data('idx');
        if(!confirm('Ta bort denna bild?')) return;
        const catKey = activeExtrasKey==='all' ? (editExtrasCat||'motorboats') : activeExtrasKey;
        extrasData[catKey][selectedExtraIndex].images.splice(imgIdx,1);
        saveExtras(()=>{
            $('#extras-msg').empty().append($('<div>').addClass('success').text('Bild borttagen'));
            setTimeout(()=>$('#extras-msg').empty(),2000);
            showExtrasEdit();
        });
    });
}

function bindSetThumbnail(){
    $('#extra-images-list .set-thumb-btn').off('click').on('click', function(){
        const imgIdx = $(this).data('idx');
        if(imgIdx===0) return; // redan thumbnail
        const catKey = activeExtrasKey==='all' ? (editExtrasCat||'motorboats') : activeExtrasKey;
        const imgs = extrasData[catKey][selectedExtraIndex].images;
        const [chosen] = imgs.splice(imgIdx,1);
        imgs.unshift(chosen);
        saveExtras(()=>{
            $('#extras-msg').empty().append($('<div>').addClass('success').text('Thumbnail uppdaterad'));
            setTimeout(()=>$('#extras-msg').empty(),2000);
            showExtrasEdit();
        });
    });
}

// Dashboard Functions
function initDashboard() {
    initChatbot();
    loadStatusItems();
    // Load sort order and update button
    const savedSort = localStorage.getItem('nyaInskickSortOrder');
    if (savedSort) {
        nyaInskickSortOrder = savedSort;
    }
    updateSortButton();
    loadChatbotPrompt();
    initFormFilters();
}

async function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    
    if (calendar) {
        calendar.destroy();
    }
    
    try {
        calendarEl.innerHTML = '<div class="folder-loading-state"><span class="folder-loading-spinner" aria-hidden="true"></span><span>Laddar kalender...</span></div>';
        await ensureFullCalendarLoaded();
        calendarEl.innerHTML = '';
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            events: getCalendarEvents(),
            eventClick: function(info) {
                alert('Händelse: ' + info.event.title);
            },
            height: 'auto'
        });
        calendar.render();
    } catch(e) {
        console.error('Kunde inte initiera kalender', e);
    }
}

function getCalendarEvents() {
    const events = [];
    Object.keys(statusItems).forEach(status => {
        statusItems[status].forEach(item => {
            if (item.date) {
                events.push({
                    title: item.title,
                    start: item.date,
                    backgroundColor: getStatusColor(status),
                    borderColor: getStatusColor(status)
                });
            }
        });
    });
    return events;
}

function getStatusColor(status) {
    const colors = {
        'nya-inskick': '#ff9800',
        'vantar-pa-svar': '#2196f3',
        'i-produktion': '#9c27b0',
        'redo-for-leverans': '#4caf50',
        'todo': '#0f766e'
    };
    return colors[status] || '#666';
}

function initFormFilters() {
    $('.form-filter-btn').off('click').on('click', function() {
        $('.form-filter-btn').removeClass('active').css({
            'background': 'white',
            'color': '#1976d2'
        });
        $(this).addClass('active').css({
            'background': '#1976d2',
            'color': 'white'
        });
        currentFormFilter = $(this).data('filter');
        renderStatusFolders();
    });
}

function initChatbot() {
    $('#chatbot-send-btn').off('click').on('click', sendChatMessage);
    $('#chatbot-input').off('keypress').on('keypress', function(e) {
        if (e.which === 13) {
            sendChatMessage();
        }
    });
}

function sendChatMessage() {
    const input = $('#chatbot-input');
    const message = input.val().trim();
    if (!message) return;
    
    // Add user message
    addChatMessage('user', message);
    input.val('');
    
    // Show loading
    const loadingId = 'loading-' + Date.now();
    addChatMessage('assistant', 'Skriver...', loadingId);
    
    const chatUrl = `${API_BASE}/api/chat`;
    
    // Call OpenAI API
    adminFetch(chatUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: message,
            prompt: chatbotPrompt
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        $(`#${loadingId}`).remove();
        if (data.success && data.response) {
            addChatMessage('assistant', data.response);
        } else {
            addChatMessage('assistant', 'Ett fel uppstod: ' + (data.error || 'Okänt fel'));
        }
    })
    .catch(error => {
        console.error('Chat error:', error);
        $(`#${loadingId}`).remove();
        addChatMessage('assistant', 'Kunde inte ansluta till servern. Kontrollera att admin_api_flask.py körs. Fel: ' + error.message);
    });
}

function addChatMessage(role, text, id) {
    const messagesDiv = $('#chatbot-messages');
    const messageDiv = $('<div>').addClass('chat-message ' + role).attr('id', id || '');
    const textDiv = $('<div>').addClass('message-text');
    
    // For assistant messages, render markdown/HTML. For user messages, escape HTML for security
    if (role === 'assistant' && typeof marked !== 'undefined') {
        // Use marked.js to render markdown to HTML
        const html = marked.parse(text);
        textDiv.html(sanitizeHtml(html));
    } else if (role === 'assistant') {
        // Fallback: simple markdown parsing if marked.js not available
        const html = simpleMarkdownToHtml(text);
        textDiv.html(sanitizeHtml(html));
    } else {
        // User messages: escape HTML for security
        textDiv.text(text);
    }
    
    const timeDiv = $('<div>').addClass('message-time').text(new Date().toLocaleTimeString('sv-SE'));
    messageDiv.append(textDiv).append(timeDiv);
    messagesDiv.append(messageDiv);
    messagesDiv.scrollTop(messagesDiv[0].scrollHeight);
}

// Simple markdown to HTML converter (fallback if marked.js not available)
function simpleMarkdownToHtml(text) {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Convert **bold** to <strong>bold</strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Convert *italic* to <em>italic</em>
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');
    
    // Convert code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    
    // Convert links [text](url) to <a href="url">text</a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // Convert lists
    html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    
    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*<\/li>)/gs, function(match) {
        if (match.includes('<ul>')) return match;
        return '<ul>' + match + '</ul>';
    });
    
    return html;
}

function loadChatbotPrompt() {
    return loadAiSettings();
}

function bindAdvancedSettings() {
    $('#save-ai-settings-btn').off('click').on('click', saveAiSettings);
    $('#reload-ai-settings-btn').off('click').on('click', loadAiSettings);
}

function bindSettings() {
    $('#save-mailgun-settings-btn').off('click').on('click', saveMailgunSettings);
    $('#reload-mailgun-settings-btn').off('click').on('click', loadMailgunSettings);
}

function loadAiSettings() {
    return adminFetch(`${API_BASE}/api/ai_settings`)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(data => {
            if (data && typeof data === 'object') {
                chatbotPrompt = String(data.admin_chat_prompt || chatbotPrompt);
                $('#admin-chatbot-prompt').val(chatbotPrompt);
                $('#assistant-system-prompt').val(String(data.assistant_system_prompt || ''));

                const formPrompts = data.form_prompts || {};
                $('#prompt-kapell').val(String(formPrompts['Kapellförfrågan'] || ''));
                $('#prompt-fender').val(String(formPrompts['Fenderförfrågan'] || ''));
                $('#prompt-kontakt').val(String(formPrompts['Kontakt'] || ''));
            }
        })
        .catch(err => {
            console.error('Kunde inte ladda AI-inställningar', err);
            $('#prompts-edit-error').text('Kunde inte ladda AI-inställningar: ' + err.message).show();
            $('#prompts-edit-success').hide();
        });
}

function saveAiSettings() {
    const nextChatPrompt = ($('#admin-chatbot-prompt').val() || '').trim();
    const payload = {
        admin_chat_prompt: nextChatPrompt || chatbotPrompt,
        assistant_system_prompt: ($('#assistant-system-prompt').val() || '').trim(),
        form_prompts: {
            'Kapellförfrågan': $('#prompt-kapell').val(),
            'Fenderförfrågan': $('#prompt-fender').val(),
            'Kontakt': $('#prompt-kontakt').val()
        }
    };

    adminFetch(`${API_BASE}/api/ai_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    })
    .then(res => {
        if (res.success) {
            chatbotPrompt = payload.admin_chat_prompt;
            $('#prompts-edit-success').text('AI-inställningar sparade!').show();
            $('#prompts-edit-error').hide();
        } else {
            $('#prompts-edit-error').text('Kunde inte spara AI-inställningar: ' + (res.error || 'Okänt fel')).show();
            $('#prompts-edit-success').hide();
        }
    })
    .catch(err => {
        console.error('Error saving ai settings:', err);
        $('#prompts-edit-error').text('Nätverksfel vid sparning.').show();
        $('#prompts-edit-success').hide();
    });
}

function loadMailgunSettings() {
    return adminFetch(`${API_BASE}/api/mailgun_settings`)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(data => {
            const recipients = Array.isArray(data.recipients) ? data.recipients.join('\n') : String(data.to || '');
            $('#mailgun-to').val(recipients);
            $('#settings-edit-error').hide();
        })
        .catch(err => {
            console.error('Kunde inte ladda Mailgun-inställningar', err);
            $('#settings-edit-error').text('Kunde inte ladda Mailgun-inställningar: ' + err.message).show();
            $('#settings-edit-success').hide();
        });
}

function saveMailgunSettings() {
    const to = ($('#mailgun-to').val() || '').trim();
    adminFetch(`${API_BASE}/api/mailgun_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to })
    })
    .then(r => {
        if (!r.ok) {
            return r.json().catch(() => ({})).then(data => {
                throw new Error(data.error || ('HTTP ' + r.status));
            });
        }
        return r.json();
    })
    .then(data => {
        const recipients = Array.isArray(data.recipients) ? data.recipients.join('\n') : to;
        $('#mailgun-to').val(recipients);
        $('#settings-edit-success').text('Mailgun-inställningar sparade.').show();
        $('#settings-edit-error').hide();
    })
    .catch(err => {
        console.error('Kunde inte spara Mailgun-inställningar', err);
        $('#settings-edit-error').text('Kunde inte spara Mailgun-inställningar: ' + err.message).show();
        $('#settings-edit-success').hide();
    });
}

function buildAdvancedSummaryItems() {
    const intent = advancedChatState.intent;
    const order = ADVANCED_SUMMARY_FIELD_ORDER[intent] || [];
    const lang = advancedChatState.language === 'en' ? 'en' : 'sv';
    const labels = ADVANCED_SUMMARY_FIELD_LABELS[lang];
    const emptyValue = lang === 'en' ? 'Not provided' : 'Ej angivet';
    const draft = advancedChatState.draft || {};
    return order.map((key) => {
        const value = String(draft[key] || '').trim();
        return {
            label: labels[key] || key,
            value: value || emptyValue
        };
    });
}

function renderAdvancedSummaryPanel() {
    const summaryEl = $('#advanced-chat-summary');
    const summaryTextEl = $('#advanced-chat-summary-text');
    const shouldShow = Boolean(advancedChatState.readyToSubmit || advancedChatState.needsConfirmation);

    if (!shouldShow) {
        summaryTextEl.empty();
        summaryEl.hide();
        return;
    }

    summaryEl.show();
    summaryTextEl.empty();

    const heading = advancedChatState.language === 'en' ? 'Summary' : 'Sammanfattning';
    summaryTextEl.append($('<div>').addClass('advanced-summary-heading').text(heading));

    const items = buildAdvancedSummaryItems();
    if (items.length) {
        const list = $('<ul>').addClass('advanced-summary-list');
        items.forEach((item) => {
            list.append($('<li>').text(`${item.label}: ${item.value}`));
        });
        summaryTextEl.append(list);
        return;
    }

    summaryTextEl.append(
        $('<div>')
            .addClass('advanced-summary-empty')
            .text(advancedChatState.summary || (advancedChatState.language === 'en' ? 'Summary unavailable.' : 'Sammanfattning saknas.'))
    );
}

function renderAdvancedChat() {
    const messagesDiv = $('#advanced-chat-messages');
    messagesDiv.empty();
    advancedChatState.history.forEach(msg => {
        const messageDiv = $('<div>').addClass('chat-message ' + (msg.role === 'user' ? 'user' : 'assistant'));
        const textDiv = $('<div>').addClass('message-text');
        if (msg.role === 'assistant' && typeof marked !== 'undefined') {
            textDiv.html(sanitizeHtml(marked.parse(msg.content || '')));
        } else if (msg.role === 'assistant') {
            textDiv.html(sanitizeHtml(simpleMarkdownToHtml(msg.content || '')));
        } else {
            textDiv.text(msg.content || '');
        }
        const timeDiv = $('<div>').addClass('message-time').text(new Date().toLocaleTimeString('sv-SE'));
        messageDiv.append(textDiv).append(timeDiv);
        messagesDiv.append(messageDiv);
    });
    if (advancedChatState.isTyping) {
        const typingMessage = $('<div>').addClass('chat-message assistant typing');
        const textDiv = $('<div>').addClass('message-text');
        const dots = $('<span>').addClass('typing-dots');
        dots.append('<span></span><span></span><span></span>');
        textDiv.append(dots);
        typingMessage.append(textDiv);
        messagesDiv.append(typingMessage);
    }

    const submitBtn = $('#advanced-chat-submit-btn');
    renderAdvancedSummaryPanel();
    submitBtn.toggle(advancedChatState.readyToSubmit);
    submitBtn.prop('disabled', advancedChatState.isSubmitting);
    submitBtn.text(
        advancedChatState.isSubmitting
            ? (advancedChatState.language === 'en' ? 'Sending...' : 'Skickar...')
            : (advancedChatState.language === 'en' ? 'Send' : 'Skicka')
    );

    const nativeMessages = $('#advanced-chat-messages');
    if (nativeMessages.length && nativeMessages[0]) {
        nativeMessages[0].scrollTop = nativeMessages[0].scrollHeight;
    }
}

async function sendAdvancedChatMessage() {
    const input = $('#advanced-chat-input');
    const sendBtn = $('#advanced-chat-send-btn');
    const message = (input.val() || '').trim();
    if (!message) return;

    advancedChatState.history.push({ role: 'user', content: message });
    advancedChatState.confirmed = false;
    advancedChatState.isTyping = true;
    renderAdvancedChat();
    input.val('');
    sendBtn.prop('disabled', true);
    input.prop('disabled', true);

    try {
        const response = await fetch(`${API_BASE}/api/assistant_chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                history: advancedChatState.history,
                draft: advancedChatState.draft,
                intent: advancedChatState.intent,
                confirmed: advancedChatState.confirmed,
                language: advancedChatState.language
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        advancedChatState.intent = typeof data.intent === 'string' ? data.intent : advancedChatState.intent;
        advancedChatState.draft = data.draft || advancedChatState.draft;
        advancedChatState.readyToSubmit = Boolean(data.ready_to_submit);
        advancedChatState.needsConfirmation = Boolean(data.needs_confirmation);
        advancedChatState.summary = data.summary || '';
        advancedChatState.confirmed = Boolean(data.confirmed);
        advancedChatState.language = data.language || advancedChatState.language;
        if (String(data.reply || '').trim()) {
            advancedChatState.history.push({
                role: 'assistant',
                content: String(data.reply)
            });
        }
    } catch (err) {
        advancedChatState.history.push({
            role: 'assistant',
            content: advancedChatState.language === 'en'
                ? `I could not answer right now: ${err.message}`
                : `Jag kunde inte svara just nu: ${err.message}`
        });
    } finally {
        advancedChatState.isTyping = false;
        sendBtn.prop('disabled', false);
        input.prop('disabled', false).focus();
        renderAdvancedChat();
    }
}

async function submitAdvancedChat() {
    if (advancedChatState.isSubmitting || !advancedChatState.readyToSubmit) return;
    advancedChatState.isSubmitting = true;
    renderAdvancedChat();
    try {
        const response = await fetch(`${API_BASE}/api/assistant_submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                intent: advancedChatState.intent,
                draft: advancedChatState.draft,
                confirmed: true
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        const lang = advancedChatState.language || 'sv';
        advancedChatState = createAdvancedChatState(lang);
        advancedChatState.history.push({
            role: 'assistant',
            content: lang === 'en'
                ? 'Thanks! Your request has been sent. Do you want to create a new request?'
                : 'Tack! Din förfrågan är skickad. Vill du skapa en ny förfrågan?'
        });
    } catch (err) {
        advancedChatState.history.push({
            role: 'assistant',
            content: advancedChatState.language === 'en'
                ? `Could not send: ${err.message}`
                : `Kunde inte skicka: ${err.message}`
        });
    } finally {
        advancedChatState.isSubmitting = false;
        renderAdvancedChat();
    }
}

function resetAdvancedChat() {
    advancedChatState = createAdvancedChatState(advancedChatState.language || 'sv');
    renderAdvancedChat();
}

function initAdvancedTestChat() {
    $('#advanced-chat-send-btn').off('click').on('click', sendAdvancedChatMessage);
    $('#advanced-chat-input').off('keypress').on('keypress', function(e) {
        if (e.which === 13) {
            sendAdvancedChatMessage();
        }
    });
    $('#advanced-chat-submit-btn').off('click').on('click', submitAdvancedChat);
    $('#advanced-chat-reset-btn').off('click').on('click', resetAdvancedChat);
    renderAdvancedChat();
}

function loadStatusItems() {
    statusFoldersLoading = true;
    renderStatusFolders();

    const defaultStatusItems = {
        'nya-inskick': [],
        'vantar-pa-svar': [],
        'i-produktion': [],
        'redo-for-leverans': [],
        'todo': []
    };

    const normalizeStatus = (value) => STATUS_FLOW.includes(value) ? value : 'nya-inskick';
    const ensureStatusBuckets = (source) => {
        const next = { ...defaultStatusItems };
        if (!source || typeof source !== 'object') return next;
        STATUS_BUCKETS.forEach(status => {
            const items = source[status];
            next[status] = Array.isArray(items) ? items : [];
        });
        return next;
    };

    try {
        const saved = localStorage.getItem('statusItems');
        if (saved) {
            statusItems = ensureStatusBuckets(JSON.parse(saved));
        }
    } catch(e) {
        console.error('Kunde inte ladda status items', e);
        statusItems = ensureStatusBuckets(statusItems);
    }

    // Keep local non-form entries and let backend be source of truth for form submissions.
    const localNonFormByStatus = ensureStatusBuckets(statusItems);
    STATUS_BUCKETS.forEach(status => {
        localNonFormByStatus[status] = localNonFormByStatus[status].filter(item => !(item && item.is_form_submission));
    });
    
    // Load form submissions from API
    adminFetch(`${API_BASE}/api/get_form_submissions`)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(submissions => {
            const formItemsByStatus = ensureStatusBuckets({});
            if (Array.isArray(submissions)) {
                submissions.forEach(submission => {
                    const status = normalizeStatus(submission.status);
                    formItemsByStatus[status].push({
                        form_id: submission.id,
                        title: submission.title,
                        description: submission.form_summary,
                        date: submission.timestamp,
                        timestamp: submission.timestamp,
                        category: submission.category,
                        form_type: submission.form_type,
                        fields: submission.fields,
                        proposed_response: submission.proposed_response,
                        notes: submission.notes || '',
                        read: Boolean(submission.read),
                        submitted_via: submission.submitted_via || 'web_form',
                        attachments: Array.isArray(submission.attachments) ? submission.attachments : [],
                        is_form_submission: true
                    });
                });
            }

            statusItems = ensureStatusBuckets({});
            STATUS_BUCKETS.forEach(status => {
                statusItems[status] = [...formItemsByStatus[status], ...localNonFormByStatus[status]];
            });

            sortNyaInskick();
            saveStatusItems();
            statusFoldersLoading = false;
            renderStatusFolders();
            updateSortButton();
        })
        .catch(err => {
            console.error('Kunde inte ladda form submissions', err);
            statusItems = ensureStatusBuckets(statusItems);
            statusFoldersLoading = false;
            renderStatusFolders();
            updateSortButton();
        });
}

function sortNyaInskick() {
    // Load sort order from localStorage
    const savedSort = localStorage.getItem('nyaInskickSortOrder');
    if (savedSort) {
        nyaInskickSortOrder = savedSort;
    }
    
    statusItems['nya-inskick'].sort((a, b) => {
        const dateA = new Date(a.date || a.timestamp || 0);
        const dateB = new Date(b.date || b.timestamp || 0);
        
        if (nyaInskickSortOrder === 'oldest') {
            return dateA - dateB; // Oldest first
        } else {
            return dateB - dateA; // Newest first (default)
        }
    });
}

function toggleNyaInskickSort() {
    nyaInskickSortOrder = nyaInskickSortOrder === 'newest' ? 'oldest' : 'newest';
    localStorage.setItem('nyaInskickSortOrder', nyaInskickSortOrder);
    sortNyaInskick();
    renderStatusFolders();
    updateSortButton();
}

function updateSortButton() {
    const btn = $('#nya-inskick-sort-btn');
    if (btn.length) {
        btn.text(nyaInskickSortOrder === 'newest' ? 'Nyaste först' : 'Äldsta först');
    }
}

function saveStatusItems() {
    try {
        localStorage.setItem('statusItems', JSON.stringify(statusItems));
        if (calendar) {
            calendar.removeAllEvents();
            const events = getCalendarEvents();
            events.forEach(event => {
                calendar.addEvent(event);
            });
        }
    } catch(e) {
        console.error('Kunde inte spara status items', e);
    }
}

function renderStatusFolders() {
    Object.keys(statusItems).forEach(status => {
        const folderDiv = $(`#folder-${status}`);
        folderDiv.empty();

        // Make folders droppable
        folderDiv.attr('data-status', status).addClass('droppable-folder');

        if (statusFoldersLoading) {
            const loadingDiv = $('<div>').addClass('folder-loading-state').attr('aria-live', 'polite');
            loadingDiv.append(
                $('<span>').addClass('folder-loading-spinner').attr('aria-hidden', 'true'),
                $('<span>').text('Laddar...')
            );
            folderDiv.append(loadingDiv);
            folderDiv.off('dragover dragleave drop').on('dragover', handleDragOver).on('dragleave', handleDragLeave).on('drop', handleDrop);
            return;
        }

        // Filter items based on current form filter for ALL folders
        let itemsToShow = statusItems[status];
        if (currentFormFilter !== 'all') {
            itemsToShow = statusItems[status].filter(item => {
                if (item.is_form_submission) {
                    return item.form_type === currentFormFilter;
                }
                return true; // Show non-form items always
            });
        }

        if (itemsToShow.length === 0) {
            // Show empty state message
            const emptyDiv = $('<div>').addClass('folder-item folder-item-empty').css({
                'text-align': 'center',
                'color': '#666',
                'font-style': 'italic',
                'padding': '2rem 1rem'
            });

            if (currentFormFilter === 'all') {
                const statusNames = {
                    'nya-inskick': 'nya inskick',
                    'vantar-pa-svar': 'väntar på svar',
                    'i-produktion': 'är i produktion',
                    'redo-for-leverans': 'är redo för leverans',
                    'todo': 'to-do'
                };
                emptyDiv.text(`Inga ${statusNames[status] || 'objekt'} att visa`);
            } else {
                const statusNames = {
                    'nya-inskick': 'nya inskick',
                    'vantar-pa-svar': 'väntar på svar',
                    'i-produktion': 'är i produktion',
                    'redo-for-leverans': 'är redo för leverans',
                    'todo': 'to-do'
                };
                emptyDiv.text(`Inga ${currentFormFilter.toLowerCase()} ${statusNames[status] || 'objekt'} att visa`);
            }
            folderDiv.append(emptyDiv);
        } else {
            itemsToShow.forEach((item, originalIndex) => {
                // Find the original index in the full array for correct operations
                const index = statusItems[status].indexOf(item);

                const itemDiv = $('<div>')
                    .addClass('folder-item')
                    .attr({
                        'data-index': index,
                        'data-status': status,
                        'draggable': 'true'
                    });

                if (item.is_form_submission) {
                    itemDiv.addClass('form-submission-item');
                }
                const header = $('<div>').addClass('folder-item-header');
                const titleDiv = $('<div>').addClass('folder-item-title');

                // For form submissions, show compact info
                if (item.is_form_submission && item.fields) {
                    const personName = getSubmissionField(item.fields, 'name', 'namn') || 'Okänd';
                    const formType = item.form_type || 'Formulär';
                    const manufacturer = getSubmissionField(item.fields, 'manufacturer', 'tillverkare');
                    const model = getSubmissionField(item.fields, 'model', 'modell');

                    titleDiv.append($('<div>').addClass('person-name').text(personName));
                    titleDiv.append($('<div>').addClass('form-type-line').text(formType));
                    if (item.submitted_via === 'ai_chatbot') {
                        titleDiv.append($('<div>').addClass('ai-source-badge').text('AI'));
                    }

                    if (formType === 'Kontakt') {
                        const subject = getSubmissionField(item.fields, 'subject', 'ämne', 'amne');
                        if (subject) {
                            titleDiv.append($('<div>').addClass('contact-subject').text(subject));
                        }
                    }

                    if (manufacturer || model) {
                        const boatInfo = [manufacturer, model].filter(Boolean).join(' ');
                        if (boatInfo) {
                            titleDiv.append($('<div>').addClass('boat-model-line').text(boatInfo));
                        }
                    }

                    if (Array.isArray(item.attachments) && item.attachments.length > 0) {
                        titleDiv.append(
                            $('<div>').addClass('attachment-badge').css({
                                fontSize: '0.78rem',
                                color: '#8b6f18',
                                marginTop: '0.2rem',
                                fontWeight: '600'
                            }).text(`📎 ${item.attachments.length} bifogad${item.attachments.length === 1 ? '' : 'e'} ${item.attachments.length === 1 ? 'fil' : 'filer'}`)
                        );
                    }

                    // Add date and time for form submissions
                    if (item.date || item.timestamp) {
                        const date = new Date(item.date || item.timestamp);
                        if (!isNaN(date.getTime())) {
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            const month = months[date.getMonth()];
                            const day = date.getDate();
                            const hours = String(date.getHours()).padStart(2, '0');
                            const minutes = String(date.getMinutes()).padStart(2, '0');
                            const dateTimeDiv = $('<div>').addClass('folder-item-content').text(`${month} ${day} ${hours}:${minutes}`);
                            itemDiv.append(dateTimeDiv);
                        }
                    }
                } else {
                    // For regular items, show title
                    titleDiv.append($('<div>').addClass('person-name').text(item.title || 'Ingen titel'));
                }

                header.append(titleDiv);
                header.append($('<button>').addClass('folder-item-delete').text('×').on('click', async function(e) {
                    e.stopPropagation();
                    if (confirm('Ta bort detta objekt?')) {
                        if (item.is_form_submission && item.form_id) {
                            const deleted = await deleteSubmissionOnServer(item);
                            if (!deleted) {
                                alert('Kunde inte ta bort från servern.');
                                return;
                            }
                            removeSubmissionFromAllStatuses(item.form_id);
                        } else {
                            statusItems[status].splice(index, 1);
                        }
                        saveStatusItems();
                        renderStatusFolders();
                    }
                }));
                itemDiv.append(header);

                // Don't show description or date for form submissions in the list
                if (!item.is_form_submission) {
                    if (item.description) {
                        const desc = $('<div>').addClass('folder-item-content');
                        const shortDesc = item.description.length > 150 ? item.description.substring(0, 150) + '...' : item.description;
                        desc.text(shortDesc);
                        itemDiv.append(desc);
                    }
                    if (item.date) {
                        itemDiv.append($('<div>').addClass('folder-item-content').text('Datum: ' + new Date(item.date).toLocaleDateString('sv-SE')));
                    }
                }

                itemDiv.on('click', function() {
                    if (item.is_form_submission) {
                        viewFormSubmission(status, index);
                    } else {
                        editStatusItem(status, index);
                    }
                });

                // Add drag and drop event handlers
                itemDiv.on('dragstart', handleDragStart);
                itemDiv.on('dragend', handleDragEnd);

                folderDiv.append(itemDiv);
            });
        }

        // Add drop event handlers to folders
        folderDiv.off('dragover dragleave drop').on('dragover', handleDragOver).on('dragleave', handleDragLeave).on('drop', handleDrop);
    });
    // Update sort button after rendering
    updateSortButton();
}

// Drag and drop functionality
let draggedItem = null;
let draggedFromStatus = null;
let draggedItemIndex = null;

function handleDragStart(e) {
    draggedItem = this;
    draggedFromStatus = $(this).attr('data-status');
    draggedItemIndex = parseInt($(this).attr('data-index'));

    // Add visual feedback
    $(this).addClass('dragging');

    // Set drag data
    e.originalEvent.dataTransfer.setData('text/plain', draggedItemIndex);
    e.originalEvent.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    $(this).removeClass('dragging');
    draggedItem = null;
    draggedFromStatus = null;
    draggedItemIndex = null;

    // Remove drag over classes from all folders
    $('.droppable-folder').removeClass('drag-over');
}

function handleDragOver(e) {
    e.preventDefault();
    e.originalEvent.dataTransfer.dropEffect = 'move';

    // Add visual feedback to drop target
    $(this).addClass('drag-over');
}

function handleDragLeave(e) {
    // Remove visual feedback when leaving drop target
    $(this).removeClass('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    $(this).removeClass('drag-over');

    const targetStatus = $(this).attr('data-status');

    // Don't move to the same status
    if (targetStatus === draggedFromStatus) {
        return;
    }

    // Get the item being dragged
    const item = statusItems[draggedFromStatus][draggedItemIndex];
    if (!item) return;
    if (item.is_form_submission && !STATUS_FLOW.includes(targetStatus)) {
        showStatusMessage('Formulärärenden kan inte flyttas till To-do');
        return;
    }

    // Remove from source status
    statusItems[draggedFromStatus].splice(draggedItemIndex, 1);

    // Add to target status
    if (!statusItems[targetStatus]) {
        statusItems[targetStatus] = [];
    }
    statusItems[targetStatus].push(item);
    if (item && item.is_form_submission) {
        updateSubmissionStatusOnServer(item, targetStatus, item.read === true);
    }

    // Save and re-render
    saveStatusItems();
    renderStatusFolders();

    // Show success message
    showStatusMessage(`Objekt flyttat till "${getStatusDisplayName(targetStatus)}"`);
}

function getStatusDisplayName(status) {
    const names = {
        'nya-inskick': 'Nya Inskick',
        'vantar-pa-svar': 'Väntar på svar',
        'i-produktion': 'I produktion',
        'redo-for-leverans': 'Redo för leverans',
        'todo': 'To-do'
    };
    return names[status] || status;
}


function showStatusMessage(message) {
    // Create a temporary status message
    const messageDiv = $('<div>')
        .addClass('status-message')
        .text(message)
        .css({
            'position': 'fixed',
            'top': '20px',
            'right': '20px',
            'background': '#4caf50',
            'color': 'white',
            'padding': '10px 20px',
            'border-radius': '4px',
            'z-index': '10000',
            'font-weight': 'bold'
        });

    $('body').append(messageDiv);

    // Remove after 3 seconds
    setTimeout(() => {
        messageDiv.fadeOut(() => messageDiv.remove());
    }, 3000);
}

async function viewFormSubmission(status, index) {
    const item = statusItems[status][index];
    if (!item || !item.is_form_submission) return;

    item.attachments = await refreshSubmissionAttachments(item);
    
    // Mark as read
    item.read = true;
    saveStatusItems();
    updateSubmissionStatusOnServer(item, status, true);
    
    // Create or update form submission modal
    let modal = $('#form-submission-modal');
    if (modal.length === 0) {
        modal = $('<div>').attr('id', 'form-submission-modal').addClass('modal');
        modal.html(`
            <div class="modal-content form-submission-modal-content">
                <div class="modal-header">
                    <h2 id="form-modal-title">Formulärinlägg</h2>
                    <button class="modal-close">×</button>
                </div>
                <div class="modal-body" id="form-modal-body">
                    <div class="form-modal-columns">
                        <div class="form-info-column" id="form-info-column">
                        </div>
                        <div class="ai-response-column" id="ai-response-column">
                        </div>
                    </div>
                </div>
            </div>
        `);
        $('body').append(modal);
        modal.find('.modal-close').on('click', function(e) {
            e.stopPropagation();
            modal.removeClass('active');
        });
        modal.on('click', function(e) {
            if (e.target === this) {
                modal.removeClass('active');
            }
        });
    }
    
    // Populate modal
    const modalTitle = item.title || 'Formulärinlägg';
    $('#form-modal-title').text(item.submitted_via === 'ai_chatbot' ? `${modalTitle} [AI]` : modalTitle);

    const infoColumn = $('#form-info-column');
    const responseColumn = $('#ai-response-column');

    infoColumn.empty();
    responseColumn.empty();

    // Form details section (LEFT COLUMN) - Simplified
    const formSection = $('<div>').addClass('form-section');

    // Just show date/time in small text at the top
    if (item.date) {
        formSection.append($('<div>').addClass('submission-date').text(`Inskickad: ${new Date(item.date).toLocaleString('sv-SE')}`));
    }

    // Form fields - the main content
    if (item.fields) {
        const fieldsList = $('<div>').addClass('form-fields');
        Object.keys(item.fields).forEach(key => {
            if (!key.startsWith('__') && item.fields[key]) {
                const fieldRow = $('<div>').addClass('form-field');
                fieldRow.append(
                    $('<strong>').text(`${getSubmissionFieldLabel(key)}:`),
                    document.createTextNode(` ${item.fields[key]}`)
                );
                fieldsList.append(fieldRow);
            }
        });
        formSection.append(fieldsList);
    }

    // Attachments (images + files)
    if (Array.isArray(item.attachments) && item.attachments.length > 0) {
        const attSection = $('<div>').addClass('form-section').css('margin-top', '1rem');
        attSection.append($('<h3>').text(`Bifogade filer (${item.attachments.length})`));
        const grid = $('<div>').addClass('attachment-grid').css({
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '0.6rem',
            marginTop: '0.4rem'
        });
        item.attachments.forEach(att => {
            const url = `${API_BASE}${att.url}`;
            const sizeKb = Math.max(1, Math.round((att.size || 0) / 1024));
            const tile = $('<div>').css({
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                overflow: 'hidden',
                background: '#f8fafc',
                fontSize: '11px'
            });
            if (att.is_image) {
                const loading = $('<div>').css({
                    height: '110px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#e2e8f0',
                    color: '#64748b',
                    fontSize: '12px'
                }).text('Laddar bild...');
                const img = $('<img>').attr('alt', att.filename).css({
                    width: '100%',
                    height: '110px',
                    objectFit: 'cover',
                    display: 'none',
                    cursor: 'pointer',
                    background: '#e2e8f0'
                });
                loadAttachmentPreviewImage(img, loading, url);
                img.on('click', () => {
                    const src = img.attr('src');
                    if (!src) return;
                    const w = window.open('', '_blank');
                    if (w) w.document.write(`<img src="${src}" style="max-width:100vw;max-height:100vh;"/>`);
                });
                tile.append(loading);
                tile.append(img);
            } else {
                tile.append($('<div>').css({
                    padding: '24px 8px',
                    textAlign: 'center',
                    fontSize: '28px'
                }).text('📎'));
            }
            const caption = $('<div>').css({
                padding: '6px 8px',
                color: '#475569',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
            });
            const dl = $('<a>').attr({ href: '#', title: att.filename })
                .css({ color: '#0a2342', textDecoration: 'none', display: 'block' })
                .text(att.filename);
            dl.on('click', function(e) {
                e.preventDefault();
                adminFetch(url).then(r => r.ok ? r.blob() : null).then(blob => {
                    if (!blob) return;
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = att.filename;
                    a.click();
                });
            });
            caption.append(dl);
            caption.append($('<div>').css({ color: '#94a3b8', fontSize: '10px' }).text(`${sizeKb} KB`));
            tile.append(caption);
            grid.append(tile);
        });
        attSection.append(grid);
        formSection.append(attSection);
    }

    const notesSection = $('<div>').addClass('form-section');
    notesSection.append($('<h3>').text('Anteckningar'));
    const notesInput = $('<textarea>')
        .addClass('submission-notes')
        .attr('placeholder', 'Skriv interna anteckningar för det här ärendet...')
        .val(item.notes || '');
    const notesActions = $('<div>').addClass('notes-actions');
    const notesStatus = $('<span>').addClass('notes-status').text(item.notes ? 'Anteckningar sparade' : '');
    const notesSaveButton = $('<button>').addClass('btn').text('Spara anteckningar');
    notesSaveButton.on('click', async function() {
        const nextNotes = String(notesInput.val() || '').trim();
        notesSaveButton.prop('disabled', true).text('Sparar...');
        notesStatus.text('');
        const ok = await updateSubmissionNotesOnServer(item, nextNotes);
        if (ok) {
            item.notes = nextNotes;
            notesStatus.text(nextNotes ? 'Anteckningar sparade' : 'Anteckningar rensade');
            showStatusMessage('Anteckningar sparade');
        } else {
            notesStatus.text('Kunde inte spara anteckningar');
        }
        notesSaveButton.prop('disabled', false).text('Spara anteckningar');
    });
    notesActions.append(notesSaveButton, notesStatus);
    notesSection.append(notesInput, notesActions);
    formSection.append(notesSection);

    infoColumn.append(formSection);

    renderAiResponsePanel(responseColumn, item, status, index, modal);

    modal.addClass('active');
}

function renderAiResponsePanel(responseColumn, item, status, index, modal) {
    responseColumn.empty();
    const responseSection = $('<div>').addClass('form-section');
    responseSection.append($('<h3>').text('AI-svar'));

    const responseDiv = $('<div>').addClass('proposed-response');
    if (item.proposed_response) {
        if (typeof marked !== 'undefined') {
            responseDiv.html(sanitizeHtml(marked.parse(item.proposed_response)));
        } else {
            responseDiv.text(item.proposed_response);
        }
    } else {
        responseDiv
            .css({ color: '#666', fontStyle: 'italic' })
            .text('Inget AI-svar skapat ännu.');
    }
    responseSection.append(responseDiv);

    const actionButtons = $('<div>').addClass('response-actions').css('margin-top', '1rem');
    const createButton = $('<button>')
        .addClass('btn')
        .text(item.proposed_response ? 'Skapa nytt AI-svar' : 'Skapa AI-svar')
        .on('click', async function() {
            if (!item.form_id) return;
            const button = $(this);
            const originalText = button.text();
            button.prop('disabled', true).text('Skapar...');
            try {
                const res = await adminFetch(`${API_BASE}/api/generate_submission_response`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: item.form_id })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    throw new Error(data.error || ('HTTP ' + res.status));
                }
                item.proposed_response = data.proposed_response || '';
                saveStatusItems();
                renderAiResponsePanel(responseColumn, item, status, index, modal);
            } catch (err) {
                alert('Kunde inte skapa AI-svar: ' + (err.message || err));
                button.prop('disabled', false).text(originalText);
            }
        });
    actionButtons.append(createButton);

    if (item.proposed_response) {
        actionButtons.append($('<button>').addClass('btn btn-secondary').css('margin-left', '0.5rem').text('Kopiera svar').on('click', function() {
            navigator.clipboard.writeText(item.proposed_response).then(() => {
                $(this).text('Kopierat!');
                setTimeout(() => $(this).text('Kopiera svar'), 2000);
            });
        }));
    }

    const nextStatus = getNextStatus(status);
    if (nextStatus) {
        actionButtons.append($('<button>').addClass('btn btn-secondary').css('margin-left', '0.5rem').text(`Flytta till ${getStatusDisplayName(nextStatus)}`).on('click', async function() {
            statusItems[status].splice(index, 1);
            if (!statusItems[nextStatus]) statusItems[nextStatus] = [];
            statusItems[nextStatus].push(item);
            item.read = true;
            saveStatusItems();
            renderStatusFolders();
            await updateSubmissionStatusOnServer(item, nextStatus, true);
            modal.removeClass('active');
        }));
    }
    responseSection.append(actionButtons);
    responseColumn.append(responseSection);
}

function editStatusItem(status, index) {
    const item = statusItems[status][index] || { title: '', description: '', date: '' };
    currentEditingItem = { status, index };
    $('#item-modal-title').text('Redigera objekt');
    $('#item-title').val(item.title || '');
    $('#item-description').val(item.description || '');
    $('#item-date').val(item.date || '');
    $('#item-modal').addClass('active');
}

function addStatusItem(status) {
    currentEditingItem = { status, index: -1 };
    $('#item-modal-title').text('Lägg till objekt');
    $('#item-title').val('');
    $('#item-description').val('');
    $('#item-date').val('');
    $('#item-modal').addClass('active');
}

function saveStatusItem() {
    const title = $('#item-title').val().trim();
    const description = $('#item-description').val().trim();
    const date = $('#item-date').val();
    
    if (!title) {
        alert('Titel krävs');
        return;
    }
    
    const item = {
        title,
        description,
        date: date || null
    };
    
    if (currentEditingItem.index >= 0) {
        statusItems[currentEditingItem.status][currentEditingItem.index] = item;
    } else {
        if (!statusItems[currentEditingItem.status]) {
            statusItems[currentEditingItem.status] = [];
        }
        statusItems[currentEditingItem.status].push(item);
    }
    
    saveStatusItems();
    renderStatusFolders();
    $('#item-modal').removeClass('active');
    currentEditingItem = null;
}

$(document).ready(function() {
    // Primära flikar
    $(document).on('click', '.primary-tab-btn', function(){
        $('.primary-tab-btn').removeClass('active');
        $(this).addClass('active');
        const prim = $(this).data('primary');
        if(prim==='dashboard'){
            switchTab('dashboard');
        } else if(prim==='texts'){
            switchTab('texts');
        } else if(prim==='advanced'){
            switchTab('advanced');
        } else if(prim==='settings'){
            switchTab('settings');
        } else if(prim==='calendar'){
            switchTab('calendar');
        } else if(prim==='analytics'){
            switchTab('analytics');
        } else if(prim==='boats'){
            switchTab('boats');
        } else if(prim==='tempproducts'){
            switchTab('tempproducts');
        } else {
            // Byt till "Visa alla" som standard
            const firstCat = activeExtrasKey || 'all';
            switchTab(firstCat);
        }
    });

    fetchManufacturers().then(()=>{
        switchTab('dashboard');
        $('#admin-tabs').hide(); // sekundära flikar dolda initialt
        $('#extras-search').hide();
    });
    bindAdvancedSettings();
    bindSettings();

    // Tab buttons
    $(document).on('click', '.tab-btn', function(){
        switchTab($(this).data('tab'));
    });
    $(document).on('click', '.analytics-range-btn', function(){
        loadAnalyticsSummary(Number($(this).data('days') || 30));
    });
    
    // Plus-knappar
    $('#add-manufacturer-btn').on('click', function() {
        const newKey = 'new_' + Date.now();
        manufacturers[newKey] = {
            name: 'Ny tillverkare',
            models: []
        };

        // Spara direkt så filen uppdateras utan extra steg
        pushFullDataset(() => {
            selectedManufacturerKey = newKey;
            selectedModelIndex = null;
            // Lägg till i UI utan att bygga om hela griden
            const item = $(`<div class="grid1-item selected-t" data-key="${newKey}">Ny tillverkare</div>`);
            $('.grid1-item').removeClass('selected-t');
            // Lägg till i Isotope-griden och layouta om direkt så höjden blir korrekt
            $grid1.append(item);
            $grid1.isotope('appended', item).isotope('layout');
            $('.grid2').empty();
            bindGridEvents(); // Bind events på nya elementet
            showEditSection();
        });
    });
    
    $('#add-model-btn').on('click', function() {
        if (!selectedManufacturerKey) {
            alert('Välj först en tillverkare att lägga till en modell under.');
            return;
        }
        const manu = manufacturers[selectedManufacturerKey];
        manu.models.push('Ny modell');

        // Spara direkt när modellen läggs till
        saveManufacturer(selectedManufacturerKey, manu, () => {
            selectedModelIndex = manu.models.length - 1;
            // Bygg bara modellistan (inte tillverkare) för att undvika layout-hopp
            buildModels();
            showEditSection();
        });
    });
    
    // Sökfunktion
    var $quicksearch = $('.quicksearch').keyup(debounce(function() {
        const query = $quicksearch.val().toLowerCase().trim();
        $grid1.isotope({
            filter: function() {
                if (!query) return true;
                return $(this).text().toLowerCase().indexOf(query) !== -1;
            }
        });
        // Nollställ val vid sökning
        selectedManufacturerKey = null;
        selectedModelIndex = null;
        $('.grid1-item').removeClass('selected-t');
        $('.grid2-item').removeClass('selected-m');
        $('.grid2').empty();
        showEditSection();
    }, 200));

    // Sök i extras
    $(document).on('keyup', '#extras-search', debounce(function(){
        const q = $('#extras-search').val().toLowerCase().trim();
        $('.extras-item').each(function(){
            const txt = $(this).attr('data-search')||'';
            $(this).toggle(txt.indexOf(q)!==-1);
        });
    }, 200));

    // Status folder buttons
    $(document).on('click', '.add-item-btn', function() {
        const status = $(this).data('status');
        addStatusItem(status);
    });

    // Item modal buttons
    $('#item-save-btn').on('click', saveStatusItem);
    $('#item-cancel-btn').on('click', function() {
        $('#item-modal').removeClass('active');
        currentEditingItem = null;
    });
    $('#item-modal').on('click', function(e) {
        if ($(e.target).hasClass('item-modal')) {
            $(this).removeClass('active');
            currentEditingItem = null;
        }
    });
});

// Markdown parser for preview (same as index.html)
function parseMarkdownForPreview(md) {
    if (!md || typeof md !== 'string') return '';
    
    // Try to use marked.js if available
    if (typeof marked !== 'undefined' && marked.parse) {
        try {
            // Configure marked to use breaks for single newlines
            if (marked.setOptions) {
                marked.setOptions({ breaks: true });
            }
            return sanitizeHtml(marked.parse(md));
        } catch(e) {
            console.warn('marked.js parse error, using fallback:', e);
        }
    }
    
    // Fallback parser - handle markdown syntax
    let html = md;
    
    // Process headings first (must be at start of line, before other processing)
    // Handle headings with or without space after #
    html = html.replace(/^###\s*(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s*(.+)$/gm, '<h1>$1</h1>');
    
    // Bold and italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Process line by line to handle paragraphs
    // Single newlines = line breaks, double newlines = new paragraph
    const lines = html.split('\n');
    const result = [];
    let currentParagraph = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        if (!trimmed) {
            // Empty line - close current paragraph if any (creates new paragraph)
            if (currentParagraph.length > 0) {
                result.push('<p>' + currentParagraph.join('<br>') + '</p>');
                currentParagraph = [];
            }
        } else if (trimmed.startsWith('<h')) {
            // Heading - close paragraph first, then add heading
            if (currentParagraph.length > 0) {
                result.push('<p>' + currentParagraph.join('<br>') + '</p>');
                currentParagraph = [];
            }
            result.push(trimmed);
        } else {
            // Regular text - add to current paragraph (will be joined with <br>)
            currentParagraph.push(trimmed);
        }
    }
    
    // Close any remaining paragraph
    if (currentParagraph.length > 0) {
        result.push('<p>' + currentParagraph.join('<br>') + '</p>');
    }
    
    return result.join('');
}

// Update preview in real-time
function updateAnnouncementPreview() {
    const text = $('#announcement-text').val() || '';
    const previewEl = $('#announcement-preview');
    
    if (!text.trim()) {
        previewEl.html('<div class="announcement-preview-empty">Förhandsvisning visas här när du skriver...</div>');
        return;
    }
    
    const html = parseMarkdownForPreview(text);
    previewEl.html(`
        <div class="announcement-preview-topbar"></div>
        <div class="announcement-preview-header">
            <div class="announcement-preview-logo"></div>
            <div class="announcement-preview-nav"></div>
        </div>
        <div class="announcement-preview-band">
            <div class="announcement-preview-wrap">
                <span class="announcement-preview-tag">Aktuellt</span>
                <div class="announcement-preview-content">
                    <div class="announcement-preview-body">${html}</div>
                    <span class="announcement-preview-cta">Kapellförfrågan</span>
                </div>
                <span class="announcement-preview-close">×</span>
            </div>
        </div>
    `);
}

// Functions for editing announcement text
function loadAnnouncementText() {
    fetch(`${API_BASE}/api/page_texts`)
        .then(r => r.json())
        .then(data => {
            if (data.announcement) {
                $('#announcement-text').val(data.announcement.text || '');
                updateAnnouncementPreview(); // Update preview when loading
            }
        })
        .catch(err => {
            console.error('Error loading announcement text:', err);
            // Load from current page if API fails (convert HTML back to markdown)
            const textContainer = document.getElementById('announcement-text');
            if (textContainer) {
                // Get text content preserving structure
                const text = textContainer.innerText || textContainer.textContent;
                $('#announcement-text').val(text);
                updateAnnouncementPreview();
            }
        });
}

function saveAnnouncementText() {
    const text = $('#announcement-text').val().trim();
    
    if (!text) {
        $('#announcement-edit-error').text('Text måste fyllas i.').show();
        $('#announcement-edit-success').hide();
        return;
    }
    
    const data = {
        announcement: {
            text: text
        }
    };
    
    adminFetch(`${API_BASE}/api/page_texts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    })
    .then(result => {
        if (result.success) {
            $('#announcement-edit-success').text('Text sparad!').show();
            $('#announcement-edit-error').hide();
        } else {
            $('#announcement-edit-error').text('Fel vid sparande: ' + (result.error || 'Okänt fel')).show();
            $('#announcement-edit-success').hide();
        }
    })
    .catch(err => {
        $('#announcement-edit-error').text('Fel vid sparande: ' + err.message).show();
        $('#announcement-edit-success').hide();
    });
}

// Functions for editing form prompts
function loadFormPrompts() {
    return loadAiSettings();
}

function saveFormPrompts() {
    return saveAiSettings();
}

// Debounce-funktion
function debounce(fn, threshold) {
    var timeout;
    threshold = threshold || 100;
    return function debounced() {
        clearTimeout(timeout);
        var args = arguments;
        var _this = this;
        function delayed() {
            fn.apply(_this, args);
        }
        timeout = setTimeout(delayed, threshold);
    };
}

// ============================== TEMP PRODUCTS ==============================
let tempProductsCache = [];
const tpSaveTimers = new WeakMap();

function escHtml(s) { return escapeHtml(s); }

async function loadTempProducts() {
    const list = document.getElementById('tp-list');
    const empty = document.getElementById('tp-empty-state');
    if (!list) return;
    list.innerHTML = '<div style="padding:1rem;color:var(--text-muted);">Laddar...</div>';
    try {
        const res = await adminFetch(`${API_BASE}/api/temp_products`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        tempProductsCache = await res.json();
    } catch (err) {
        console.error('Kunde inte ladda produkter', err);
        list.innerHTML = '<div style="padding:1rem;color:#dc2626;">Kunde inte ladda produkter. ' + escHtml(err.message || '') + '</div>';
        return;
    }
    renderTempProducts();
}

function renderTempProducts() {
    const list = document.getElementById('tp-list');
    const empty = document.getElementById('tp-empty-state');
    if (!list) return;
    list.innerHTML = '';
    if (!Array.isArray(tempProductsCache) || tempProductsCache.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    tempProductsCache.forEach(product => list.appendChild(buildTempProductCard(product)));
}

function buildTempProductCard(product) {
    const card = document.createElement('div');
    card.className = 'tp-card';
    card.dataset.productId = product.id;
    card.innerHTML = `
        <div class="tp-fields">
            <div>
                <label>Titel</label>
                <input type="text" class="tp-title" value="${escHtml(product.title || '')}" placeholder="Produktens namn">
            </div>
            <div class="tp-row-2col">
                <div>
                    <label>Pris</label>
                    <input type="text" class="tp-price" value="${escHtml(product.price || '')}" placeholder="t.ex. 2 495 kr">
                </div>
                <div>
                    <label>Sorteringsordning</label>
                    <input type="text" class="tp-sort" value="${escHtml(String(product.sort_order || 0))}" placeholder="0">
                </div>
            </div>
            <div>
                <label>Beskrivning</label>
                <textarea class="tp-description" placeholder="Beskriv produkten...">${escHtml(product.description || '')}</textarea>
            </div>
            <div class="tp-actions">
                <span class="tp-save-status"></span>
                <button type="button" class="btn btn-danger tp-delete">Ta bort produkt</button>
            </div>
        </div>
        <div class="tp-images">
            <div>
                <label>Bilder (${(product.images || []).length})</label>
                <div class="tp-images-grid"></div>
            </div>
            <label class="tp-dropzone" tabindex="0">
                <div style="font-size:1.6rem;margin-bottom:.3rem;">📷</div>
                <div style="font-size:.92rem;">Klicka eller dra och släpp bilder</div>
                <div style="font-size:.78rem;opacity:.7;margin-top:.2rem;">JPG, PNG, WEBP, GIF · max 8 MB/bild</div>
                <input type="file" class="tp-file-input" multiple accept="image/*">
            </label>
            <div class="tp-upload-status"></div>
        </div>
    `;
    renderTempProductImages(card, product);
    bindTempProductCard(card, product);
    return card;
}

function renderTempProductImages(card, product) {
    const grid = card.querySelector('.tp-images-grid');
    grid.innerHTML = '';
    (product.images || []).forEach(img => {
        const tile = document.createElement('div');
        tile.className = 'tp-thumb';
        tile.innerHTML = `
            <img src="${API_BASE}${img.url}" alt="${escHtml(img.filename || '')}">
            <button type="button" class="tp-thumb-del" title="Ta bort bild" data-image-id="${img.id}">×</button>
        `;
        tile.querySelector('.tp-thumb-del').addEventListener('click', async (e) => {
            e.preventDefault();
            if (!confirm('Ta bort den här bilden?')) return;
            try {
                const res = await adminFetch(`${API_BASE}/api/temp_product_image/${img.id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                product.images = (product.images || []).filter(i => i.id !== img.id);
                renderTempProductImages(card, product);
                card.querySelector('.tp-images label').textContent = `Bilder (${product.images.length})`;
            } catch (err) {
                alert('Kunde inte ta bort bild: ' + (err.message || err));
            }
        });
        grid.appendChild(tile);
    });
}

function bindTempProductCard(card, product) {
    const titleInput = card.querySelector('.tp-title');
    const priceInput = card.querySelector('.tp-price');
    const sortInput = card.querySelector('.tp-sort');
    const descInput = card.querySelector('.tp-description');
    const status = card.querySelector('.tp-save-status');

    function scheduleSave() {
        clearTimeout(tpSaveTimers.get(card));
        status.textContent = 'Sparar...';
        status.classList.remove('is-saved', 'is-error');
        const t = setTimeout(() => saveTempProduct(card, product, status), 600);
        tpSaveTimers.set(card, t);
    }

    [titleInput, priceInput, sortInput, descInput].forEach(el => {
        el.addEventListener('input', scheduleSave);
    });

    card.querySelector('.tp-delete').addEventListener('click', async () => {
        if (!confirm(`Ta bort produkten "${product.title || 'utan titel'}"? Detta kan inte ångras.`)) return;
        try {
            const res = await adminFetch(`${API_BASE}/api/temp_products/${product.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            tempProductsCache = tempProductsCache.filter(p => p.id !== product.id);
            renderTempProducts();
        } catch (err) {
            alert('Kunde inte ta bort produkt: ' + (err.message || err));
        }
    });

    // File upload
    const dropzone = card.querySelector('.tp-dropzone');
    const fileInput = card.querySelector('.tp-file-input');
    const uploadStatus = card.querySelector('.tp-upload-status');

    async function uploadFiles(files) {
        if (!files || !files.length) return;
        const fd = new FormData();
        Array.from(files).forEach(f => fd.append('images', f, f.name));
        uploadStatus.textContent = `Laddar upp ${files.length} bild${files.length === 1 ? '' : 'er'}...`;
        try {
            const res = await adminFetch(`${API_BASE}/api/temp_products/${product.id}/images`, { method: 'POST', body: fd });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            product.images = [...(product.images || []), ...(data.images || [])];
            renderTempProductImages(card, product);
            card.querySelector('.tp-images label').textContent = `Bilder (${product.images.length})`;
            uploadStatus.textContent = `${(data.images || []).length} bild${(data.images || []).length === 1 ? '' : 'er'} uppladdade.`;
            setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
        } catch (err) {
            uploadStatus.textContent = 'Fel vid uppladdning: ' + (err.message || err);
        }
    }

    fileInput.addEventListener('change', () => {
        uploadFiles(fileInput.files);
        fileInput.value = '';
    });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-drag'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-drag');
        uploadFiles(e.dataTransfer.files);
    });
}

async function saveTempProduct(card, product, status) {
    const title = card.querySelector('.tp-title').value;
    const price = card.querySelector('.tp-price').value;
    const sort = parseInt(card.querySelector('.tp-sort').value, 10) || 0;
    const description = card.querySelector('.tp-description').value;
    try {
        const res = await adminFetch(`${API_BASE}/api/temp_products/${product.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, price, sort_order: sort, description })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const updated = await res.json();
        product.title = updated.title;
        product.price = updated.price;
        product.description = updated.description;
        product.sort_order = updated.sort_order;
        status.textContent = 'Sparat ✓';
        status.classList.add('is-saved');
        setTimeout(() => { status.textContent = ''; status.classList.remove('is-saved'); }, 2000);
    } catch (err) {
        status.textContent = 'Fel: ' + (err.message || err);
        status.classList.add('is-error');
    }
}

async function addTempProduct() {
    try {
        const res = await adminFetch(`${API_BASE}/api/temp_products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Ny produkt', description: '', price: '', sort_order: tempProductsCache.length })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const product = await res.json();
        tempProductsCache.push(product);
        renderTempProducts();
    } catch (err) {
        alert('Kunde inte skapa produkt: ' + (err.message || err));
    }
}

$(document).on('click', '#tp-add-btn', addTempProduct);
