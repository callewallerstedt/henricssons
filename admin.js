// Adminpanel för tillverkare och modeller
// Bygger grid och sökfält likt kapellförfrågan, men med redigering

let manufacturers = typeof boatData !== 'undefined' ? boatData : {};
let selectedManufacturerKey = null;
let selectedModelIndex = null;
let $grid1, $grid2;
let analyticsRangeDays = 30;
let customerConfirmationDefaultTemplate = '';
let customerConfirmationPreviewFormType = 'Kontakt';
let customerConfirmationPreviewTimer = null;
let customerConfirmationPreviewRequestId = 0;

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
const DEFAULT_WORKFLOW_STATUSES = [
    { id: 'nya-inskick', name: 'Nya inskick', fixed: true },
    { id: 'vantar-pa-svar', name: 'Väntar på svar', fixed: false },
    { id: 'i-produktion', name: 'I produktion', fixed: false },
    { id: 'redo-for-leverans', name: 'Redo för leverans', fixed: false }
];
const TODO_STATUS = { id: 'todo', name: 'To-do', fixed: true };
const ARCHIVE_STATUS = { id: 'arkiv', name: 'Arkiv', fixed: true };
const STATUS_COLOR_PALETTE = ['#ff9800', '#2563eb', '#0f766e', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0284c7', '#4f46e5', '#65a30d', '#b45309', '#dc2626'];
const STATUS_SUMMARY_HINTS = [
    'Obesvarade förfrågningar',
    'Under uppföljning',
    'Aktiva arbeten',
    'Klara att skicka'
];
const STATUS_SUMMARY_CARD_CLASSES = ['', 'is-warning', 'is-info', 'is-success'];
let workflowStatuses = DEFAULT_WORKFLOW_STATUSES.map(status => ({ ...status }));

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

function cloneDefaultWorkflowStatuses() {
    return DEFAULT_WORKFLOW_STATUSES.map(status => ({ ...status }));
}

function sanitizeStatusName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function slugifyStatusId(value) {
    const normalized = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return normalized;
}

function normalizeWorkflowStatuses(source) {
    const defaults = cloneDefaultWorkflowStatuses();
    const raw = Array.isArray(source)
        ? source
        : (source && Array.isArray(source.statuses) ? source.statuses : []);
    if (!raw.length) return defaults;

    const normalized = [{ ...defaults[0] }];
    const seen = new Set(['nya-inskick']);

    raw.forEach(entry => {
        if (!entry || typeof entry !== 'object') return;
        const rawId = String(entry.id || '').trim().toLowerCase();
        if (rawId === 'nya-inskick') return;
        const name = sanitizeStatusName(entry.name);
        if (!name) return;
        let id = /^[a-z0-9][a-z0-9-]{0,47}$/.test(rawId) && rawId !== TODO_STATUS.id && rawId !== ARCHIVE_STATUS.id ? rawId : '';
        if (!id || seen.has(id)) {
            const base = slugifyStatusId(name) || 'status';
            id = base;
            let suffix = 2;
            while (!id || seen.has(id) || id === TODO_STATUS.id || id === ARCHIVE_STATUS.id || id === 'nya-inskick') {
                id = `${base}-${suffix}`.slice(0, 48);
                suffix += 1;
            }
        }
        normalized.push({ id, name, fixed: false });
        seen.add(id);
    });

    return normalized.length > 1 ? normalized : defaults;
}

function getWorkflowStatuses() {
    return Array.isArray(workflowStatuses) && workflowStatuses.length
        ? workflowStatuses
        : cloneDefaultWorkflowStatuses();
}

function getWorkflowStatusIds() {
    return getWorkflowStatuses().map(status => status.id);
}

function getStatusBuckets() {
    return [...getWorkflowStatusIds(), TODO_STATUS.id, ARCHIVE_STATUS.id];
}

function isWorkflowStatus(statusId) {
    return getWorkflowStatusIds().includes(statusId);
}

function getWorkflowStatusIndex(statusId) {
    return getWorkflowStatuses().findIndex(status => status.id === statusId);
}

function createEmptyStatusItems() {
    const next = {};
    getStatusBuckets().forEach(statusId => {
        next[statusId] = [];
    });
    return next;
}

function getStatusColor(statusId) {
    if (statusId === TODO_STATUS.id) return '#0f766e';
    if (statusId === ARCHIVE_STATUS.id) return '#64748b';
    const index = getWorkflowStatusIndex(statusId);
    if (index >= 0) return STATUS_COLOR_PALETTE[index % STATUS_COLOR_PALETTE.length];
    return '#666';
}

function getStatusDisplayName(statusId) {
    if (statusId === TODO_STATUS.id) return TODO_STATUS.name;
    if (statusId === ARCHIVE_STATUS.id) return ARCHIVE_STATUS.name;
    const match = getWorkflowStatuses().find(status => status.id === statusId);
    return match ? match.name : statusId;
}

function ensureStatusBuckets(source) {
    const next = createEmptyStatusItems();
    if (!source || typeof source !== 'object') return next;

    const knownBuckets = new Set(getStatusBuckets());
    getStatusBuckets().forEach(statusId => {
        const items = source[statusId];
        next[statusId] = Array.isArray(items) ? items.filter(Boolean) : [];
    });

    Object.keys(source).forEach(statusId => {
        if (knownBuckets.has(statusId)) return;
        const items = Array.isArray(source[statusId]) ? source[statusId].filter(Boolean) : [];
        items.forEach(item => {
            const fallbackStatus = item && item.is_form_submission ? 'nya-inskick' : TODO_STATUS.id;
            next[fallbackStatus].push(item);
        });
    });

    return next;
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
    batmodell: 'Båtmodell',
    namn: 'Namn',
    meddelande: 'Meddelande',
    mobil: 'Mobilnummer',
    boat_year: 'Årsmodell',
    arsmodell: 'Årsmodell',
    home_port: 'Hemmahamn + Ort',
    hemmahamn: 'Hemmahamn + Ort',
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
let activeAttachmentLightboxUrl = null;

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

function closeAttachmentLightbox() {
    const lightbox = $('#attachment-lightbox');
    const image = $('#attachment-lightbox-image');
    lightbox.removeClass('active').attr('aria-hidden', 'true');
    image.attr('src', '').attr('alt', '');
    $('#attachment-lightbox-caption').text('');
    if (activeAttachmentLightboxUrl) {
        URL.revokeObjectURL(activeAttachmentLightboxUrl);
        activeAttachmentLightboxUrl = null;
    }
    $('body').css('overflow', '');
}

async function openAttachmentLightbox(url, filename) {
    try {
        const res = await adminFetch(url);
        const blob = res.ok ? await res.blob() : null;
        if (!blob) throw new Error('empty attachment blob');
        const objectUrl = URL.createObjectURL(blob);
        if (activeAttachmentLightboxUrl) {
            URL.revokeObjectURL(activeAttachmentLightboxUrl);
        }
        activeAttachmentLightboxUrl = objectUrl;
        $('#attachment-lightbox-image').attr('src', objectUrl).attr('alt', filename || 'Bilaga');
        $('#attachment-lightbox-caption').text(filename || '');
        $('#attachment-lightbox').addClass('active').attr('aria-hidden', 'false');
        $('body').css('overflow', 'hidden');
    } catch (err) {
        console.warn('Kunde inte öppna bilaga', err);
        showStatusMessage('Kunde inte öppna bilden');
    }
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
    const workflowIds = getWorkflowStatusIds();
    const idx = workflowIds.indexOf(status);
    if (idx < 0 || idx === workflowIds.length - 1) return null;
    return workflowIds[idx + 1];
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
let statusItems = createEmptyStatusItems();
let nyaInskickSortOrder = 'newest'; // 'newest' or 'oldest'
let currentFormFilter = 'all'; // 'all', 'Kapellförfrågan', 'Fenderförfrågan', 'Dynsatsförfrågan', 'Kontakt'
let statusBoardSearchQuery = '';
let chatbotPrompt = 'Du är en hjälpsam assistent för Henricssons Båtkapell. Du hjälper till med frågor om båtkapell, beställningar och allmän service.';
let currentEditingItem = null;
let statusFoldersLoading = false;
let statusConfigDraft = [];
let statusBoardRecoveryTimer = null;
const SUBMISSION_ROUTE_TYPES = [
    { key: 'Kapellforfragan', label: 'Kapellf\u00f6rfr\u00e5gan' },
    { key: 'Fenderforfragan', label: 'Fenderf\u00f6rfr\u00e5gan' },
    { key: 'Dynsatsforfragan', label: 'Dynsatsf\u00f6rfr\u00e5gan' },
    { key: 'Kontakt', label: 'Kontakt' }
];

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
        home_port: 'Hemmahamn + Ort',
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
        home_port: 'Home port + City',
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
    if ($grid1 && typeof $grid1.isotope === 'function') {
        try {
            $grid1.isotope('destroy');
        } catch (_) {}
    }
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
    $grid1 = grid1;
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

function refreshManufacturerListLayout(showEditor = false) {
    $('.quicksearch').val('');
    buildGrids();
    if (!showEditor) $('.grid2').empty();
    if (showEditor) {
        showEditSection();
        return;
    }
    $('#edit-section').removeClass('editing').html('<h2>Redigering</h2><p>Välj en tillverkare för att börja.</p>').hide();
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
        deleteManufacturer(selectedManufacturerKey, ()=>{
            selectedManufacturerKey=null;
            selectedModelIndex=null;
            refreshManufacturerListLayout(false);
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
            refreshManufacturerListLayout(true);
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

function parseSubmissionDateValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : `${raw}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatSubmissionDateTime(value) {
    const date = parseSubmissionDateValue(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Stockholm',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function formatSubmissionDateOnly(value) {
    const date = parseSubmissionDateValue(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Stockholm',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function formatSubmissionDateShortLabel(value) {
    const date = parseSubmissionDateValue(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Stockholm',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
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
        $('#dynsatser-section').hide();
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
        $('#dynsatser-section').hide();
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
        $('#dynsatser-section').hide();
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
        $('#dynsatser-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadStatusConfig().finally(() => loadMailgunSettings());
        loadCustomerConfirmationSettings();
    } else if(tab==='calendar'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').addClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('#dynsatser-section').hide();
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
        $('#dynsatser-section').hide();
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
        $('#dynsatser-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadTempProducts();
    } else if(tab==='dynsatser'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('#tempproducts-section').hide();
        $('#dynsatser-section').show();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadDynsatser();
    } else {
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#advanced-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').show();
        $('#tempproducts-section').hide();
        $('#dynsatser-section').hide();
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
    loadStatusConfig().finally(() => {
        renderStatusBoardLayout();
        loadStatusItems();
        scheduleStatusBoardRecovery(true);
    });
    // Load sort order and update button
    const savedSort = localStorage.getItem('nyaInskickSortOrder');
    if (savedSort) {
        nyaInskickSortOrder = savedSort;
    }
    updateSortButton();
    loadChatbotPrompt();
    initFormFilters();
    initStatusConfigModal();
    scheduleStatusBoardRecovery(false);
}

function scheduleStatusBoardRecovery(fullReload = false) {
    clearTimeout(statusBoardRecoveryTimer);
    statusBoardRecoveryTimer = setTimeout(() => {
        const workflowRoot = $('#status-folders-workflow');
        if (!workflowRoot.length) return;

        const hasColumns = workflowRoot.children('.status-folder').length > 0;
        const hasSummaryCards = $('#status-summary-row .stat-card').length > 0;
        if (hasColumns && hasSummaryCards) return;

        loadStatusConfig()
            .catch(() => {})
            .finally(() => {
                renderStatusBoardLayout();
                if (fullReload) {
                    loadStatusItems();
                } else {
                    renderStatusFolders();
                }
            });
    }, 450);
}

async function loadStatusConfig() {
    try {
        const res = await adminFetch(`${API_BASE}/api/status_config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        workflowStatuses = normalizeWorkflowStatuses(data);
    } catch (err) {
        console.error('Kunde inte ladda statuskonfiguration', err);
        workflowStatuses = cloneDefaultWorkflowStatuses();
    }
    statusItems = ensureStatusBuckets(statusItems);
    updateStatusSummaryCards();
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
    getStatusBuckets().forEach(status => {
        (statusItems[status] || []).forEach(item => {
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
    $('#status-board-search').off('input search').on('input search', function() {
        statusBoardSearchQuery = String($(this).val() || '').trim().toLowerCase();
        renderStatusFolders();
    });
}

function submissionMatchesSearch(item, query) {
    if (!query) return true;
    const parts = [];
    if (item.is_form_submission && item.fields) {
        Object.entries(item.fields).forEach(([key, value]) => {
            if (!key.startsWith('__') && value) parts.push(String(value));
        });
        parts.push(item.form_type || '');
    } else {
        parts.push(item.title || '', item.description || '');
    }
    parts.push(item.notes || '');
    return parts.join(' ').toLowerCase().includes(query);
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
    $('#save-customer-confirmation-btn').off('click').on('click', saveCustomerConfirmationSettings);
    $('#reload-customer-confirmation-btn').off('click').on('click', loadCustomerConfirmationSettings);
    $('#reset-customer-confirmation-btn').off('click').on('click', resetCustomerConfirmationTemplate);
    $('#customer-confirmation-template').off('input.customerConfirmation').on('input.customerConfirmation', scheduleCustomerConfirmationPreview);
    $(document)
        .off('click.customerConfirmationPreview', '.customer-confirmation-preview-type')
        .on('click.customerConfirmationPreview', '.customer-confirmation-preview-type', function() {
            setCustomerConfirmationPreviewType($(this).data('formType'));
        });
    setCustomerConfirmationPreviewType(customerConfirmationPreviewFormType);
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

function getSubmissionRouteStatusOptions(selectedStatusId) {
    const selected = String(selectedStatusId || 'nya-inskick');
    return getWorkflowStatuses().map(status => {
        const id = String(status.id || '').trim();
        if (!id) return '';
        const label = String(status.name || id);
        return `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}

function normalizeSubmissionRoutes(routes) {
    const normalized = {};
    SUBMISSION_ROUTE_TYPES.forEach(type => {
        const raw = routes && typeof routes === 'object' ? (routes[type.key] || {}) : {};
        normalized[type.key] = {
            form_type: type.key,
            label: type.label,
            status_id: String(raw.status_id || 'nya-inskick'),
            recipients: Array.isArray(raw.recipients) ? raw.recipients : [],
            to: Array.isArray(raw.recipients) ? raw.recipients.join('\n') : String(raw.to || '')
        };
    });
    return normalized;
}

function renderSubmissionRoutingSettings(routes) {
    const root = $('#submission-routing-settings');
    if (!root.length) return;
    const normalized = normalizeSubmissionRoutes(routes);
    root.empty();
    SUBMISSION_ROUTE_TYPES.forEach(type => {
        const route = normalized[type.key];
        const row = $(`
            <div class="submission-route-row" data-form-type="${escapeHtml(type.key)}" style="border:1px solid var(--border); border-radius:10px; padding:0.85rem; background:#f8fafc;">
                <div style="display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); align-items:start;">
                    <div>
                        <label style="margin-bottom:0.35rem;">Formul&auml;r</label>
                        <div style="font-weight:700; color:var(--text-primary);">${escapeHtml(type.label)}</div>
                    </div>
                    <div>
                        <label for="route-status-${escapeHtml(type.key)}">Mapp</label>
                        <select id="route-status-${escapeHtml(type.key)}" class="submission-route-status" style="width:100%; padding:0.7rem; border:1px solid var(--border); border-radius:8px; background:#fff;">
                            ${getSubmissionRouteStatusOptions(route.status_id)}
                        </select>
                    </div>
                    <div>
                        <label for="route-recipients-${escapeHtml(type.key)}">Mottagare</label>
                        <textarea id="route-recipients-${escapeHtml(type.key)}" class="submission-route-recipients" rows="2" placeholder="Tomt = global lista" style="width:100%; min-height:4.4rem;">${escapeHtml(route.to || '')}</textarea>
                    </div>
                </div>
            </div>
        `);
        root.append(row);
    });
}

function collectSubmissionRoutingSettings() {
    const routes = {};
    $('#submission-routing-settings .submission-route-row').each(function() {
        const row = $(this);
        const key = String(row.data('formType') || '');
        if (!key) return;
        routes[key] = {
            status_id: String(row.find('.submission-route-status').val() || 'nya-inskick'),
            to: String(row.find('.submission-route-recipients').val() || '').trim()
        };
    });
    return routes;
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
            renderSubmissionRoutingSettings(data.submission_routes || {});
            $('#settings-edit-error').hide();
        })
        .catch(err => {
            console.error('Kunde inte ladda Mailgun-inställningar', err);
            $('#settings-edit-error').text('Kunde inte ladda Mailgun-inställningar: ' + err.message).show();
            $('#settings-edit-success').hide();
        });
}

function loadCustomerConfirmationSettings() {
    return adminFetch(`${API_BASE}/api/customer_confirmation_settings`)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(data => {
            const bodyTemplate = String((data && data.body_template) || '');
            customerConfirmationDefaultTemplate = String((data && data.default_body_template) || '');
            $('#customer-confirmation-template').val(bodyTemplate);
            $('#customer-confirmation-default-template').val(customerConfirmationDefaultTemplate);
            $('#settings-edit-error').hide();
            return refreshCustomerConfirmationPreview();
        })
        .catch(err => {
            console.error('Kunde inte ladda kundmejl', err);
            $('#settings-edit-error').text('Kunde inte ladda kundmejl: ' + err.message).show();
            $('#settings-edit-success').hide();
        });
}

function saveMailgunSettings() {
    const to = ($('#mailgun-to').val() || '').trim();
    const submission_routes = collectSubmissionRoutingSettings();
    adminFetch(`${API_BASE}/api/mailgun_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, submission_routes })
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
        renderSubmissionRoutingSettings(data.submission_routes || submission_routes);
        $('#settings-edit-success').text('Mailgun-inställningar sparade.').show();
        $('#settings-edit-error').hide();
    })
    .catch(err => {
        console.error('Kunde inte spara Mailgun-inställningar', err);
        $('#settings-edit-error').text('Kunde inte spara Mailgun-inställningar: ' + err.message).show();
        $('#settings-edit-success').hide();
    });
}

function saveCustomerConfirmationSettings() {
    const bodyTemplate = ($('#customer-confirmation-template').val() || '').trim();
    adminFetch(`${API_BASE}/api/customer_confirmation_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_template: bodyTemplate })
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
        customerConfirmationDefaultTemplate = String(data.default_body_template || customerConfirmationDefaultTemplate || '');
        $('#customer-confirmation-template').val(String(data.body_template || bodyTemplate));
        $('#customer-confirmation-default-template').val(customerConfirmationDefaultTemplate);
        $('#settings-edit-success').text('Kundmejlet sparades.').show();
        $('#settings-edit-error').hide();
        return refreshCustomerConfirmationPreview();
    })
    .catch(err => {
        console.error('Kunde inte spara kundmejl', err);
        $('#settings-edit-error').text('Kunde inte spara kundmejl: ' + err.message).show();
        $('#settings-edit-success').hide();
    });
}

function resetCustomerConfirmationTemplate() {
    $('#customer-confirmation-template').val(customerConfirmationDefaultTemplate || '');
    refreshCustomerConfirmationPreview();
}

function setCustomerConfirmationPreviewType(formType) {
    customerConfirmationPreviewFormType = String(formType || 'Kontakt');
    $('.customer-confirmation-preview-type').each(function() {
        const isActive = String($(this).data('formType')) === customerConfirmationPreviewFormType;
        $(this).toggleClass('btn', isActive);
        $(this).toggleClass('btn-secondary', !isActive);
    });
    refreshCustomerConfirmationPreview();
}

function scheduleCustomerConfirmationPreview() {
    clearTimeout(customerConfirmationPreviewTimer);
    customerConfirmationPreviewTimer = setTimeout(() => {
        refreshCustomerConfirmationPreview();
    }, 180);
}

function refreshCustomerConfirmationPreview() {
    const frame = $('#customer-confirmation-preview-frame');
    if (!frame.length) return Promise.resolve();

    const requestId = ++customerConfirmationPreviewRequestId;
    const bodyTemplate = ($('#customer-confirmation-template').val() || '').trim();
    $('#customer-confirmation-preview-meta').text('Laddar...');

    return adminFetch(`${API_BASE}/api/customer_confirmation_preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            form_type: customerConfirmationPreviewFormType,
            body_template: bodyTemplate
        })
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
        if (requestId !== customerConfirmationPreviewRequestId) return;
        const iframe = frame.get(0);
        if (iframe) iframe.srcdoc = String(data.html_body || '');
        $('#customer-confirmation-preview-meta').text(`${String(data.form_label || '')} - ${String(data.subject || '')}`);
    })
    .catch(err => {
        if (requestId !== customerConfirmationPreviewRequestId) return;
        console.error('Kunde inte generera forhandsvisning', err);
        const iframe = frame.get(0);
        if (iframe) iframe.srcdoc = '';
        $('#customer-confirmation-preview-meta').text('Forhandsvisningen kunde inte laddas.');
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
        const dateA = parseSubmissionDateValue(a.date || a.timestamp) || new Date(0);
        const dateB = parseSubmissionDateValue(b.date || b.timestamp) || new Date(0);

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
                        const date = parseSubmissionDateValue(item.date || item.timestamp);
                        if (!isNaN(date.getTime())) {
                            const dateTimeDiv = $('<div>').addClass('folder-item-content').text(formatSubmissionDateShortLabel(item.date || item.timestamp));
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
                        itemDiv.append($('<div>').addClass('folder-item-content').text('Datum: ' + formatSubmissionDateOnly(item.date)));
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

function updateStatusSummaryCards() {
    const row = $('#status-summary-row');
    if (!row.length) return;
    row.empty();

    getWorkflowStatuses().slice(0, 4).forEach((status, index) => {
        const card = $('<div>').addClass('stat-card');
        if (STATUS_SUMMARY_CARD_CLASSES[index]) {
            card.addClass(STATUS_SUMMARY_CARD_CLASSES[index]);
        }
        card.append(
            $('<div>').addClass('stat-label').text(status.name),
            $('<div>').addClass('stat-value').attr('id', `stat-${status.id}`).text('0'),
            $('<div>').addClass('stat-hint').text(STATUS_SUMMARY_HINTS[index] || 'Överblick')
        );
        row.append(card);
    });
}

function updateStatusSummaryCounts() {
    getWorkflowStatuses().slice(0, 4).forEach(status => {
        const target = document.getElementById(`stat-${status.id}`);
        if (!target) return;
        target.textContent = String((statusItems[status.id] || []).length);
    });
}

function renderStatusBoardLayout() {
    const workflowRoot = $('#status-folders-workflow');
    if (!workflowRoot.length) return;

    workflowRoot.empty();
    getWorkflowStatuses().forEach(status => {
        const card = $('<div>')
            .addClass('status-folder')
            .attr('data-status', status.id)
            .css('--status-accent', getStatusColor(status.id));

        const header = $('<div>').addClass('status-folder-top');
        const titleWrap = $('<div>').addClass('status-folder-title-wrap');
        titleWrap.append($('<h3>').text(status.name));
        if (status.id === 'nya-inskick') {
            titleWrap.append(
                $('<button>')
                    .attr('type', 'button')
                    .attr('id', 'nya-inskick-sort-btn')
                    .addClass('btn-ghost status-sort-btn')
                    .text('Nyaste först')
                    .on('click', toggleNyaInskickSort)
            );
        }
        header.append(titleWrap);
        card.append(header);
        card.append($('<div>').addClass('folder-items').attr('id', `folder-${status.id}`));
        card.append($('<button>').addClass('add-item-btn').attr('type', 'button').attr('data-status', status.id).text('+ Lägg till'));
        workflowRoot.append(card);
    });

    $('#status-folder-todo').css('--status-accent', getStatusColor(TODO_STATUS.id));
    updateSortButton();
}

function openStatusConfigModal() {
    statusConfigDraft = getWorkflowStatuses().map(status => ({
        clientId: status.id,
        id: status.id,
        name: status.name,
        fixed: status.id === 'nya-inskick'
    }));
    renderStatusConfigDraftList();
    $('#status-config-modal').addClass('active');
}

function closeStatusConfigModal() {
    $('#status-config-modal').removeClass('active');
}

function getStatusItemCount(statusId) {
    return Array.isArray(statusItems[statusId]) ? statusItems[statusId].length : 0;
}

function moveStatusDraftItem(clientId, direction) {
    const index = statusConfigDraft.findIndex(status => status.clientId === clientId);
    if (index <= 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex <= 0 || targetIndex >= statusConfigDraft.length) return;
    const [item] = statusConfigDraft.splice(index, 1);
    statusConfigDraft.splice(targetIndex, 0, item);
    renderStatusConfigDraftList();
}

function moveStatusDraftClientId(clientId, targetIndex) {
    const index = statusConfigDraft.findIndex(status => status.clientId === clientId);
    if (index <= 0) return;
    const status = statusConfigDraft[index];
    if (!status || status.fixed) return;
    const boundedIndex = Math.max(1, Math.min(targetIndex, statusConfigDraft.length - 1));
    if (boundedIndex === index) return;
    const [item] = statusConfigDraft.splice(index, 1);
    statusConfigDraft.splice(boundedIndex, 0, item);
    renderStatusConfigDraftList();
}

function removeStatusDraftItem(clientId) {
    const index = statusConfigDraft.findIndex(status => status.clientId === clientId);
    if (index < 0) return;
    const status = statusConfigDraft[index];
    if (status.fixed) return;

    const itemCount = status.id ? getStatusItemCount(status.id) : 0;
    if (itemCount > 0) {
        showStatusMessage('Mappen måste vara tom innan du kan ta bort den');
        return;
    }

    statusConfigDraft.splice(index, 1);
    renderStatusConfigDraftList();
}

function renderStatusConfigDraftList() {
    const list = $('#status-config-list');
    if (!list.length) return;
    list.empty();
    list.off('dragover.statusConfigList drop.statusConfigList');

    statusConfigDraft.forEach((status, index) => {
        const row = $('<div>').addClass('status-config-row');
        if (status.fixed) row.addClass('is-fixed');

        const input = $('<input>')
            .attr('type', 'text')
            .addClass('status-config-input')
            .val(status.name)
            .prop('disabled', status.fixed)
            .attr('placeholder', 'Namn på status');
        input.on('input', function() {
            status.name = sanitizeStatusName($(this).val());
        });

        const actions = $('<div>').addClass('status-config-row-actions');
        actions.append(
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-move-btn')
                .text('↑')
                .prop('disabled', status.fixed || index <= 1)
                .on('click', function() { moveStatusDraftItem(status.clientId, 'up'); }),
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-move-btn')
                .text('↓')
                .prop('disabled', status.fixed || index >= statusConfigDraft.length - 1)
                .on('click', function() { moveStatusDraftItem(status.clientId, 'down'); })
        );

        row.append(input, actions);
        list.append(row);
    });
}

function renderStatusConfigDraftList() {
    const list = $('#status-config-list');
    if (!list.length) return;
    list.empty();

    statusConfigDraft.forEach((status, index) => {
        const row = $('<div>').addClass('status-config-row');
        if (status.fixed) row.addClass('is-fixed');

        const input = $('<input>')
            .attr('type', 'text')
            .addClass('status-config-input')
            .val(status.name)
            .prop('disabled', status.fixed)
            .attr('placeholder', 'Namn på status');
        input.on('input', function() {
            status.name = sanitizeStatusName($(this).val());
        });

        const actions = $('<div>').addClass('status-config-row-actions');
        actions.append(
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-move-btn')
                .text('↑')
                .prop('disabled', status.fixed || index <= 1)
                .on('click', function() { moveStatusDraftItem(status.clientId, 'up'); }),
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-move-btn')
                .text('↓')
                .prop('disabled', status.fixed || index >= statusConfigDraft.length - 1)
                .on('click', function() { moveStatusDraftItem(status.clientId, 'down'); }),
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-delete-btn')
                .text('×')
                .prop('disabled', status.fixed)
                .on('click', function() { removeStatusDraftItem(status.clientId); })
        );

        const itemCount = status.id ? getStatusItemCount(status.id) : 0;
        const meta = $('<div>').addClass('status-config-meta');
        meta.text(status.fixed ? 'Fast mapp' : (itemCount > 0 ? `${itemCount} objekt i mappen` : 'Tom mapp'));

        row.append(input, actions, meta);
        list.append(row);
    });
}

async function saveStatusConfigFromModal() {
    const payload = {
        statuses: statusConfigDraft.map(status => ({
            id: status.fixed ? status.id : status.id,
            name: status.fixed ? getStatusDisplayName(status.id) : sanitizeStatusName(status.name)
        }))
    };

    const customStatuses = payload.statuses.filter(status => status.id !== 'nya-inskick');
    if (!customStatuses.every(status => status.name)) {
        showStatusMessage('Alla statusar måste ha namn.');
        return;
    }

    const saveBtn = $('#status-config-save-btn');
    const originalText = saveBtn.text();
    saveBtn.prop('disabled', true).text('Sparar...');

    try {
        const res = await adminFetch(`${API_BASE}/api/status_config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        workflowStatuses = normalizeWorkflowStatuses(data);
        statusItems = ensureStatusBuckets(statusItems);
        renderStatusBoardLayout();
        renderStatusFolders();
        updateStatusSummaryCards();
        saveStatusItems();
        closeStatusConfigModal();
        showStatusMessage('Statusmappar sparade');
    } catch (err) {
        console.error('Kunde inte spara statuskonfiguration', err);
        showStatusMessage('Kunde inte spara statusmapparna');
    } finally {
        saveBtn.prop('disabled', false).text(originalText);
    }
}

function initStatusConfigModal() {
    $('#status-config-open-btn').off('click').on('click', openStatusConfigModal);
    $('#status-config-close-btn, #status-config-cancel-btn').off('click').on('click', closeStatusConfigModal);
    $('#status-config-add-btn').off('click').on('click', function() {
        statusConfigDraft.push({
            clientId: `draft-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            id: '',
            name: '',
            fixed: false
        });
        renderStatusConfigDraftList();
    });
    $('#status-config-save-btn').off('click').on('click', saveStatusConfigFromModal);
    $('#status-config-modal')
        .off('mousedown.statusConfig mouseup.statusConfig click.statusConfig')
        .on('mousedown.statusConfig', function(e) {
            this.dataset.backdropPressStarted = $(e.target).is('#status-config-modal') ? 'true' : 'false';
        })
        .on('mouseup.statusConfig', function(e) {
            const startedOnBackdrop = this.dataset.backdropPressStarted === 'true';
            this.dataset.backdropPressStarted = 'false';
            if (startedOnBackdrop && $(e.target).is('#status-config-modal')) {
                closeStatusConfigModal();
            }
        })
        .on('click.statusConfig', function(e) {
            if ($(e.target).is('#status-config-modal')) {
                e.preventDefault();
            }
        });
}

async function loadStatusConfig() {
    try {
        const res = await adminFetch(`${API_BASE}/api/status_config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        workflowStatuses = normalizeWorkflowStatuses(data);
    } catch (err) {
        console.error('Kunde inte ladda statuskonfiguration', err);
        workflowStatuses = cloneDefaultWorkflowStatuses();
    }
    statusItems = ensureStatusBuckets(statusItems);
    updateStatusSummaryCards();
    renderStatusBoardLayout();
}

function loadStatusItems() {
    statusFoldersLoading = true;
    renderStatusFolders();

    const normalizeStatus = (value) => isWorkflowStatus(value) ? value : 'nya-inskick';

    try {
        const saved = localStorage.getItem('statusItems');
        if (saved) {
            statusItems = ensureStatusBuckets(JSON.parse(saved));
        }
    } catch(e) {
        console.error('Kunde inte ladda status items', e);
        statusItems = ensureStatusBuckets(statusItems);
    }

    const localNonFormByStatus = ensureStatusBuckets(statusItems);
    getStatusBuckets().forEach(status => {
        localNonFormByStatus[status] = (localNonFormByStatus[status] || []).filter(item => !(item && item.is_form_submission));
    });

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
            getStatusBuckets().forEach(status => {
                statusItems[status] = [...(formItemsByStatus[status] || []), ...(localNonFormByStatus[status] || [])];
            });

            sortNyaInskick();
            saveStatusItems();
            statusFoldersLoading = false;
            renderStatusFolders();
        })
        .catch(err => {
            console.error('Kunde inte ladda form submissions', err);
            statusItems = ensureStatusBuckets(statusItems);
            statusFoldersLoading = false;
            renderStatusFolders();
        });
}

function sortNyaInskick() {
    const savedSort = localStorage.getItem('nyaInskickSortOrder');
    if (savedSort) {
        nyaInskickSortOrder = savedSort;
    }

    (statusItems['nya-inskick'] || []).sort((a, b) => {
        const dateA = parseSubmissionDateValue(a.date || a.timestamp) || new Date(0);
        const dateB = parseSubmissionDateValue(b.date || b.timestamp) || new Date(0);

        if (nyaInskickSortOrder === 'oldest') {
            return dateA - dateB;
        } else {
            return dateB - dateA;
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
        updateStatusSummaryCounts();
    } catch(e) {
        console.error('Kunde inte spara status items', e);
    }
}

function renderStatusFolders() {
    renderStatusBoardLayout();

    getStatusBuckets().forEach(status => {
        const folderDiv = $(`#folder-${status}`);
        if (!folderDiv.length) return;
        folderDiv.empty();
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

        let itemsToShow = statusItems[status] || [];
        if (currentFormFilter !== 'all') {
            itemsToShow = itemsToShow.filter(item => {
                if (item.is_form_submission) {
                    return item.form_type === currentFormFilter;
                }
                return true;
            });
        }

        if (itemsToShow.length === 0) {
            const emptyDiv = $('<div>').addClass('folder-item folder-item-empty').css({
                'text-align': 'center',
                'color': '#666',
                'font-style': 'italic',
                'padding': '2rem 1rem'
            });

            const statusName = getStatusDisplayName(status).toLowerCase();
            if (currentFormFilter === 'all') {
                emptyDiv.text(`Inga ${statusName} att visa`);
            } else {
                emptyDiv.text(`Inga ${currentFormFilter.toLowerCase()} i ${statusName}`);
            }
            folderDiv.append(emptyDiv);
        } else {
            itemsToShow.forEach(item => {
                const index = (statusItems[status] || []).indexOf(item);

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
                            }).text(`Bilagor: ${item.attachments.length}`)
                        );
                    }

                    if (item.date || item.timestamp) {
                        const date = parseSubmissionDateValue(item.date || item.timestamp);
                        if (!isNaN(date.getTime())) {
                            const dateTimeDiv = $('<div>').addClass('folder-item-content').text(formatSubmissionDateShortLabel(item.date || item.timestamp));
                            itemDiv.append(dateTimeDiv);
                        }
                    }
                } else {
                    titleDiv.append($('<div>').addClass('person-name').text(item.title || 'Ingen titel'));
                }

                header.append(titleDiv);
                header.append($('<button>').addClass('folder-item-delete').attr('type', 'button').text('×').on('click', async function(e) {
                    e.stopPropagation();
                    if (!confirm('Ta bort detta objekt?')) return;
                    if (item.is_form_submission && item.form_id) {
                        const deleted = await deleteSubmissionOnServer(item);
                        if (!deleted) {
                            alert('Kunde inte ta bort från servern.');
                            return;
                        }
                        removeSubmissionFromAllStatuses(item.form_id);
                    } else {
                        (statusItems[status] || []).splice(index, 1);
                    }
                    saveStatusItems();
                    renderStatusFolders();
                }));
                itemDiv.append(header);

                if (!item.is_form_submission) {
                    if (item.description) {
                        const desc = $('<div>').addClass('folder-item-content');
                        const shortDesc = item.description.length > 150 ? item.description.substring(0, 150) + '...' : item.description;
                        desc.text(shortDesc);
                        itemDiv.append(desc);
                    }
                    if (item.date) {
                        itemDiv.append($('<div>').addClass('folder-item-content').text('Datum: ' + formatSubmissionDateOnly(item.date)));
                    }
                }

                itemDiv.on('click', function() {
                    if (item.is_form_submission) {
                        viewFormSubmission(status, index);
                    } else {
                        editStatusItem(status, index);
                    }
                });

                itemDiv.on('dragstart', handleDragStart);
                itemDiv.on('dragend', handleDragEnd);

                folderDiv.append(itemDiv);
            });
        }

        folderDiv.off('dragover dragleave drop').on('dragover', handleDragOver).on('dragleave', handleDragLeave).on('drop', handleDrop);
    });

    updateSortButton();
    updateStatusSummaryCounts();
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

async function handleDrop(e) {
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
    if (item.is_form_submission && !isWorkflowStatus(targetStatus)) {
        showStatusMessage('Formulärärenden kan inte flyttas till To-do');
        return;
    }

    if (item && item.is_form_submission) {
        const updated = await updateSubmissionStatusOnServer(item, targetStatus, item.read === true);
        if (!updated) {
            showStatusMessage('Kunde inte spara statusändringen');
            return;
        }
    }

    // Remove from source status
    statusItems[draggedFromStatus].splice(draggedItemIndex, 1);

    // Add to target status
    if (!statusItems[targetStatus]) {
        statusItems[targetStatus] = [];
    }
    statusItems[targetStatus].push(item);

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


function getStatusDisplayName(status) {
    if (status === TODO_STATUS.id) return TODO_STATUS.name;
    const match = getWorkflowStatuses().find(item => item.id === status);
    return match ? match.name : status;
}

async function handleDrop(e) {
    e.preventDefault();
    $(this).removeClass('drag-over');

    const targetStatus = $(this).attr('data-status');
    if (targetStatus === draggedFromStatus) {
        return;
    }

    const item = statusItems[draggedFromStatus]?.[draggedItemIndex];
    if (!item) return;
    if (item.is_form_submission && !isWorkflowStatus(targetStatus)) {
        showStatusMessage('Formulärärenden kan inte flyttas till To-do');
        return;
    }

    const originalFromStatus = draggedFromStatus;
    const originalIndex = draggedItemIndex;
    statusItems[originalFromStatus].splice(originalIndex, 1);
    if (!statusItems[targetStatus]) {
        statusItems[targetStatus] = [];
    }
    statusItems[targetStatus].push(item);
    saveStatusItems();
    renderStatusFolders();
    showStatusMessage(`Objekt flyttat till "${getStatusDisplayName(targetStatus)}"`);

    if (!item.is_form_submission) {
        return;
    }

    const updated = await updateSubmissionStatusOnServer(item, targetStatus, item.read === true);
    if (updated) {
        return;
    }

    statusItems[targetStatus] = (statusItems[targetStatus] || []).filter(candidate => candidate !== item);
    if (!statusItems[originalFromStatus]) {
        statusItems[originalFromStatus] = [];
    }
    statusItems[originalFromStatus].splice(Math.min(originalIndex, statusItems[originalFromStatus].length), 0, item);
    saveStatusItems();
    renderStatusFolders();
    showStatusMessage('Kunde inte spara statusändringen');
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
    renderStatusFolders();
    const updated = await updateSubmissionStatusOnServer(item, status, true);
    if (!updated) {
        showStatusMessage('Kunde inte spara läst-status');
    }

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
        formSection.append($('<div>').addClass('submission-date').text(`Inskickad: ${formatSubmissionDateTime(item.date)}`));
    }

    // Form fields - the main content
    if (item.fields) {
        const fieldsList = $('<div>').addClass('form-fields');
        const fieldPriority = (key) => {
            const nk = normalizeSubmissionFieldKey(key);
            const order = [
                'namn', 'name',
                'e_post', 'e_postadress', 'epost', 'email',
                'telefon', 'telefonnummer', 'phone', 'mobil',
                'tillverkare', 'manufacturer', 'modell', 'model', 'batmodell', 'boat_model', 'boat_brand',
                'arsmodell', 'boat_year', 'hemmahamn', 'home_port'
            ];
            const idx = order.indexOf(nk);
            if (idx >= 0) return idx;
            if (['meddelande', 'message', 'beskrivning', 'description', 'ovrigt'].includes(nk)) return 900;
            return 500;
        };
        Object.keys(item.fields).sort((a, b) => fieldPriority(a) - fieldPriority(b)).forEach(key => {
            if (!key.startsWith('__') && item.fields[key]) {
                const fieldRow = $('<div>').addClass('form-field');
                fieldRow.append($('<strong>').text(`${getSubmissionFieldLabel(key)}:`));
                const value = String(item.fields[key]);
                const normalizedKey = normalizeSubmissionFieldKey(key);
                if (['email', 'e_post', 'e_postadress', 'epost'].includes(normalizedKey) && value.includes('@')) {
                    fieldRow.append(document.createTextNode(' '), $('<a>').attr('href', `mailto:${value.trim()}`).text(value));
                } else if (['telefon', 'phone', 'telefonnummer', 'tel', 'mobil'].includes(normalizedKey)) {
                    const telValue = value.replace(/[^+\d]/g, '');
                    if (telValue.length >= 5) {
                        fieldRow.append(document.createTextNode(' '), $('<a>').attr('href', `tel:${telValue}`).text(value));
                    } else {
                        fieldRow.append(document.createTextNode(` ${value}`));
                    }
                } else {
                    fieldRow.append(document.createTextNode(` ${value}`));
                }
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
                loadAttachmentPreviewImage(img, loading, url, true);
                img.on('click', () => openAttachmentLightbox(url, att.filename));
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

function getSubmissionCustomerEmail(item) {
    return String(getSubmissionField(item.fields || {}, 'email', 'e-post', 'e-postadress', 'epost') || '').trim();
}

function buildReplyMailtoUrl(item, body) {
    const email = getSubmissionCustomerEmail(item);
    if (!email) return '';
    const formType = String(item.form_type || '');
    const topic = formType && formType !== 'Kontakt' ? `din ${formType.toLowerCase()}` : 'ditt meddelande till oss';
    const subject = `Ang. ${topic} – Henricssons Båtkapell`;
    let url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;
    if (body) {
        url += `&body=${encodeURIComponent(body)}`;
    }
    return url;
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

    if (getSubmissionCustomerEmail(item)) {
        actionButtons.append($('<button>').addClass('btn btn-secondary').css('margin-left', '0.5rem').text('Svara via e-post').on('click', function() {
            let body = String(item.proposed_response || '');
            if (body.length > 1500) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(body);
                }
                showStatusMessage('AI-svaret är långt – det har kopierats. Klistra in det i mejlet.');
                body = '';
            }
            window.location.href = buildReplyMailtoUrl(item, body);
        }));
    }

    const nextStatus = getNextStatus(status);
    if (nextStatus) {
        actionButtons.append($('<button>').addClass('btn btn-secondary').css('margin-left', '0.5rem').text(`Flytta till ${getStatusDisplayName(nextStatus)}`).on('click', async function() {
            const previousRead = Boolean(item.read);
            statusItems[status].splice(index, 1);
            if (!statusItems[nextStatus]) statusItems[nextStatus] = [];
            statusItems[nextStatus].push(item);
            item.read = true;
            saveStatusItems();
            renderStatusFolders();
            showStatusMessage(`Objekt flyttat till "${getStatusDisplayName(nextStatus)}"`);

            const updated = await updateSubmissionStatusOnServer(item, nextStatus, true);
            if (!updated) {
                statusItems[nextStatus] = (statusItems[nextStatus] || []).filter(candidate => candidate !== item);
                if (!statusItems[status]) statusItems[status] = [];
                statusItems[status].splice(Math.min(index, statusItems[status].length), 0, item);
                item.read = previousRead;
                saveStatusItems();
                renderStatusFolders();
                showStatusMessage('Kunde inte spara statusändringen');
                return;
            }
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
    $('#attachment-lightbox-close').on('click', closeAttachmentLightbox);
    $('#attachment-lightbox').on('click', function(e) {
        if (e.target === this) closeAttachmentLightbox();
    });
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#attachment-lightbox').hasClass('active')) {
            closeAttachmentLightbox();
        }
    });

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
        } else if(prim==='dynsatser'){
            switchTab('dynsatser');
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
        // Spara direkt så filen uppdateras utan extra steg
        pushFullDataset(() => {
            selectedManufacturerKey = newKey;
            selectedModelIndex = null;
            refreshManufacturerListLayout(true);
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
        $('.grid1-item').each(function() {
            const match = !query || $(this).text().toLowerCase().indexOf(query) !== -1;
            $(this).toggle(match);
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

// ============================== BOAT BRANDS (DYNSATSER) ==============================
let boatBrandsCache = [];
let dynManufacturersCache = [];
const bbSaveTimers = new WeakMap();
const tmSaveTimers = new WeakMap();

async function loadDynsatser() {
    await loadDynManufacturers();
    await loadBoatBrands();
}

async function loadDynManufacturers() {
    const list = document.getElementById('tm-list');
    if (!list) return;
    try {
        const res = await adminFetch(`${API_BASE}/api/dyn_manufacturers`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        dynManufacturersCache = await res.json();
    } catch (err) {
        list.innerHTML = '<div style="padding:1rem;color:#dc2626;">Kunde inte ladda tillverkare. ' + escHtml(err.message || '') + '</div>';
        return;
    }
    renderDynManufacturers();
}

function renderDynManufacturers() {
    const list = document.getElementById('tm-list');
    const empty = document.getElementById('tm-empty-state');
    if (!list) return;
    list.innerHTML = '';
    if (!Array.isArray(dynManufacturersCache) || dynManufacturersCache.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    dynManufacturersCache.forEach(mfr => list.appendChild(buildManufacturerRow(mfr)));
}

function dynManufacturerImageSrc(mfr) {
    const raw = (mfr && (mfr.image_url || mfr.primary_image_url || mfr.default_logo_url)) || '';
    if (!raw) return `${API_BASE}/logo.png`;
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:')) return raw;
    return `${API_BASE}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function buildManufacturerRow(mfr) {
    const row = document.createElement('div');
    row.className = 'tm-row';
    row.dataset.manufacturerId = mfr.id;
    const count = mfr.entry_count || 0;
    row.innerHTML = `
        <span class="tm-drag" title="Sorteringsordning">☰</span>
        <div class="tm-logo"><img src="${escHtml(dynManufacturerImageSrc(mfr))}" alt="${escHtml(mfr.name || 'Tillverkare')}"></div>
        <input type="text" class="tm-name" value="${escHtml(mfr.name || '')}" placeholder="t.ex. Buster">
        <span class="tm-count">${count} dynsats${count === 1 ? '' : 'er'}</span>
        <span class="tm-image-actions">
            <button type="button" class="tm-upload">Byt bild</button>
            <button type="button" class="tm-reset-image"${mfr.image_url ? '' : ' disabled'}>Standard</button>
            <input type="file" class="tm-file" accept="image/jpeg,image/png,image/webp">
        </span>
        <span class="tm-status"></span>
        <button type="button" class="tm-del" title="Ta bort tillverkare">🗑</button>
    `;
    const nameInput = row.querySelector('.tm-name');
    const status = row.querySelector('.tm-status');
    nameInput.addEventListener('input', () => {
        clearTimeout(tmSaveTimers.get(row));
        status.textContent = 'Sparar...';
        status.classList.remove('is-saved', 'is-error');
        tmSaveTimers.set(row, setTimeout(() => saveManufacturer(mfr, nameInput.value, status), 600));
    });
    row.querySelector('.tm-upload').addEventListener('click', () => row.querySelector('.tm-file').click());
    row.querySelector('.tm-file').addEventListener('change', event => uploadManufacturerImage(mfr, event.target.files && event.target.files[0], row));
    row.querySelector('.tm-reset-image').addEventListener('click', () => resetManufacturerImage(mfr, row));
    row.querySelector('.tm-del').addEventListener('click', () => deleteManufacturer(mfr));
    return row;
}

async function saveManufacturer(mfr, name, status, extra = {}) {
    try {
        const res = await adminFetch(`${API_BASE}/api/dyn_manufacturers/${mfr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, ...extra })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const updated = await res.json();
        Object.assign(mfr, updated);
        const cached = dynManufacturersCache.find(m => m.id === mfr.id);
        if (cached) Object.assign(cached, updated);
        status.textContent = 'Sparat ✓';
        status.classList.add('is-saved');
        setTimeout(() => { status.textContent = ''; status.classList.remove('is-saved'); }, 2000);
        // Refresh entry dropdowns so the new name shows there too.
        refreshManufacturerDropdowns();
        return updated;
    } catch (err) {
        status.textContent = 'Fel';
        status.classList.add('is-error');
    }
}

function updateManufacturerImagePreview(mfr, row) {
    const img = row.querySelector('.tm-logo img');
    if (img) {
        img.src = dynManufacturerImageSrc(mfr);
        img.alt = mfr.name || 'Tillverkare';
    }
    const resetBtn = row.querySelector('.tm-reset-image');
    if (resetBtn) resetBtn.disabled = !mfr.image_url;
}

function readManufacturerImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Kunde inte lasa filen'));
        reader.readAsDataURL(file);
    });
}

async function uploadManufacturerImage(mfr, file, row) {
    if (!file) return;
    const status = row.querySelector('.tm-status');
    const input = row.querySelector('.tm-file');
    try {
        status.textContent = 'Laddar upp...';
        status.classList.remove('is-saved', 'is-error');
        const dataUrl = await readManufacturerImageFile(file);
        const slug = slugifyStatusId(mfr.name || 'tillverkare') || `tillverkare-${mfr.id}`;
        const res = await adminFetch(`${API_BASE}/api/upload_image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: dataUrl,
                rel_path: `dynsatser/tillverkare/${slug}-${Date.now()}`
            })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.success) throw new Error(payload.error || ('HTTP ' + res.status));
        const savedPath = String(payload.saved_path || '').replace(/^henricssons_bilder[\\/]/, '').replace(/\\/g, '/');
        await saveManufacturer(mfr, mfr.name || '', status, { image_url: `/henricssons_bilder/${savedPath}` });
        updateManufacturerImagePreview(mfr, row);
    } catch (err) {
        status.textContent = 'Fel';
        status.classList.add('is-error');
        alert('Kunde inte spara tillverkarbild: ' + (err.message || err));
    } finally {
        if (input) input.value = '';
    }
}

async function resetManufacturerImage(mfr, row) {
    const status = row.querySelector('.tm-status');
    await saveManufacturer(mfr, mfr.name || '', status, { image_url: '' });
    updateManufacturerImagePreview(mfr, row);
}

async function deleteManufacturer(mfr) {
    if (!confirm(`Ta bort tillverkaren "${mfr.name || 'utan namn'}"? Dynsatser under den blir okopplade (raderas inte).`)) return;
    try {
        const res = await adminFetch(`${API_BASE}/api/dyn_manufacturers/${mfr.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        dynManufacturersCache = dynManufacturersCache.filter(m => m.id !== mfr.id);
        // Any entries pointing here are now unassigned locally.
        boatBrandsCache.forEach(b => { if (b.manufacturer_id === mfr.id) b.manufacturer_id = null; });
        renderDynManufacturers();
        refreshManufacturerDropdowns();
    } catch (err) {
        alert('Kunde inte ta bort tillverkare: ' + (err.message || err));
    }
}

async function addManufacturer() {
    try {
        const res = await adminFetch(`${API_BASE}/api/dyn_manufacturers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Ny tillverkare', sort_order: dynManufacturersCache.length })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const mfr = await res.json();
        mfr.entry_count = 0;
        dynManufacturersCache.push(mfr);
        renderDynManufacturers();
        refreshManufacturerDropdowns();
        document.getElementById('tm-list').lastElementChild?.querySelector('.tm-name')?.select();
    } catch (err) {
        alert('Kunde inte skapa tillverkare: ' + (err.message || err));
    }
}

function manufacturerOptionsHtml(selectedId) {
    const opts = ['<option value="">— Välj tillverkare —</option>'];
    dynManufacturersCache.forEach(m => {
        const sel = String(m.id) === String(selectedId) ? ' selected' : '';
        opts.push(`<option value="${m.id}"${sel}>${escHtml(m.name || 'utan namn')}</option>`);
    });
    return opts.join('');
}

function refreshManufacturerDropdowns() {
    document.querySelectorAll('#bb-list .bb-manufacturer').forEach(sel => {
        const current = sel.value;
        sel.innerHTML = manufacturerOptionsHtml(current);
    });
}

$(document).on('click', '#tm-add-btn', addManufacturer);

async function loadBoatBrands() {
    const list = document.getElementById('bb-list');
    const empty = document.getElementById('bb-empty-state');
    if (!list) return;
    list.innerHTML = '<div style="padding:1rem;color:var(--text-muted);">Laddar...</div>';
    try {
        const res = await adminFetch(`${API_BASE}/api/boat_brands`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        boatBrandsCache = await res.json();
    } catch (err) {
        list.innerHTML = '<div style="padding:1rem;color:#dc2626;">Kunde inte ladda dynsatser. ' + escHtml(err.message || '') + '</div>';
        return;
    }
    renderBoatBrands();
}

function renderBoatBrands() {
    const list = document.getElementById('bb-list');
    const empty = document.getElementById('bb-empty-state');
    if (!list) return;
    list.innerHTML = '';
    if (!Array.isArray(boatBrandsCache) || boatBrandsCache.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    boatBrandsCache.forEach(brand => list.appendChild(buildBoatBrandCard(brand)));
}

function buildBoatBrandCard(brand) {
    const card = document.createElement('div');
    card.className = 'bb-card';
    card.dataset.brandId = brand.id;
    const slug = brand.slug || '';
    card.innerHTML = `
        <div class="bb-fields">
            <div>
                <label>Namn (modell)</label>
                <input type="text" class="bb-name" value="${escHtml(brand.name || '')}" placeholder="t.ex. Magnum">
            </div>
            <div>
                <label>Tillverkare</label>
                <select class="bb-manufacturer">${manufacturerOptionsHtml(brand.manufacturer_id)}</select>
            </div>
            <div class="bb-row-2col">
                <div>
                    <label>Sorteringsordning</label>
                    <input type="text" class="bb-sort" value="${escHtml(String(brand.sort_order || 0))}" placeholder="0">
                </div>
                <div style="display:flex;align-items:flex-end;">
                    ${slug ? `<a href="/dynsatser/${escHtml(slug)}" target="_blank" style="font-size:0.82rem;color:var(--primary);text-decoration:none;white-space:nowrap;">↗ Se sida</a>` : ''}
                </div>
            </div>
            <div>
                <label>Beskrivning</label>
                <textarea class="bb-description" placeholder="Beskriv dynsatsen...">${escHtml(brand.description || '')}</textarea>
            </div>
            <div class="bb-actions">
                <span class="bb-save-status"></span>
                <button type="button" class="btn btn-danger bb-delete">Ta bort dynsats</button>
            </div>
        </div>
        <div class="bb-images">
            <div>
                <label>Bilder (${(brand.images || []).length})</label>
                <div class="bb-images-grid"></div>
                <div class="bb-cover-hint"></div>
            </div>
            <label class="bb-dropzone" tabindex="0">
                <div style="font-size:1.6rem;margin-bottom:.3rem;">📷</div>
                <div style="font-size:.92rem;">Klicka eller dra och släpp bilder</div>
                <div style="font-size:.78rem;opacity:.7;margin-top:.2rem;">JPG, PNG, WEBP, GIF · max 8 MB/bild</div>
                <input type="file" class="bb-file-input" multiple accept="image/*">
            </label>
            <div class="bb-upload-status"></div>
        </div>
    `;
    renderBoatBrandImages(card, brand);
    bindBoatBrandCard(card, brand);
    return card;
}

function renderBoatBrandImages(card, brand) {
    const grid = card.querySelector('.bb-images-grid');
    grid.innerHTML = '';
    const images = brand.images || [];
    // Default cover is the first image if none explicitly chosen.
    const effectiveCover = brand.cover_image_id != null ? brand.cover_image_id : (images[0] && images[0].id);
    images.forEach(img => {
        const tile = document.createElement('div');
        tile.className = 'bb-thumb' + (img.id === effectiveCover ? ' is-cover' : '');
        tile.innerHTML = `
            <img src="${API_BASE}${img.url}" alt="${escHtml(img.filename || '')}">
            <button type="button" class="bb-thumb-cover" title="${img.id === effectiveCover ? 'Omslagsbild' : 'Använd som omslag'}" data-image-id="${img.id}">${img.id === effectiveCover ? '★' : '☆'}</button>
            <button type="button" class="bb-thumb-del" title="Ta bort bild" data-image-id="${img.id}">×</button>
        `;
        tile.querySelector('.bb-thumb-cover').addEventListener('click', (e) => {
            e.preventDefault();
            setBoatBrandCover(card, brand, img.id);
        });
        tile.querySelector('.bb-thumb-del').addEventListener('click', async (e) => {
            e.preventDefault();
            if (!confirm('Ta bort den här bilden?')) return;
            try {
                const res = await adminFetch(`${API_BASE}/api/boat_brand_image/${img.id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                brand.images = (brand.images || []).filter(i => i.id !== img.id);
                if (brand.cover_image_id === img.id) brand.cover_image_id = null;
                renderBoatBrandImages(card, brand);
                card.querySelector('.bb-images label').textContent = `Bilder (${brand.images.length})`;
            } catch (err) {
                alert('Kunde inte ta bort bild: ' + (err.message || err));
            }
        });
        grid.appendChild(tile);
    });
    const hint = card.querySelector('.bb-cover-hint');
    if (hint) hint.textContent = images.length
        ? 'Stjärnmarkerad bild visas först på sidan.'
        : '';
}

async function setBoatBrandCover(card, brand, imageId) {
    try {
        const res = await adminFetch(`${API_BASE}/api/boat_brands/${brand.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cover_image_id: imageId })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const updated = await res.json();
        brand.cover_image_id = updated.cover_image_id;
        const cached = boatBrandsCache.find(b => b.id === brand.id);
        if (cached) cached.cover_image_id = updated.cover_image_id;
        renderBoatBrandImages(card, brand);
    } catch (err) {
        alert('Kunde inte sätta omslagsbild: ' + (err.message || err));
    }
}

function bindBoatBrandCard(card, brand) {
    const nameInput = card.querySelector('.bb-name');
    const sortInput = card.querySelector('.bb-sort');
    const descInput = card.querySelector('.bb-description');
    const mfrSelect = card.querySelector('.bb-manufacturer');
    const status = card.querySelector('.bb-save-status');

    function scheduleSave() {
        clearTimeout(bbSaveTimers.get(card));
        status.textContent = 'Sparar...';
        status.classList.remove('is-saved', 'is-error');
        const t = setTimeout(() => saveBoatBrand(card, brand, status), 600);
        bbSaveTimers.set(card, t);
    }

    [nameInput, sortInput, descInput].forEach(el => el.addEventListener('input', scheduleSave));
    // Manufacturer change saves immediately (also refresh tillverkare counts after).
    mfrSelect.addEventListener('change', () => {
        status.textContent = 'Sparar...';
        status.classList.remove('is-saved', 'is-error');
        saveBoatBrand(card, brand, status).then(() => loadDynManufacturers());
    });

    card.querySelector('.bb-delete').addEventListener('click', async () => {
        if (!confirm(`Ta bort märket "${brand.name || 'utan namn'}"? Detta kan inte ångras.`)) return;
        try {
            const res = await adminFetch(`${API_BASE}/api/boat_brands/${brand.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            boatBrandsCache = boatBrandsCache.filter(b => b.id !== brand.id);
            renderBoatBrands();
        } catch (err) {
            alert('Kunde inte ta bort märke: ' + (err.message || err));
        }
    });

    const dropzone = card.querySelector('.bb-dropzone');
    const fileInput = card.querySelector('.bb-file-input');
    const uploadStatus = card.querySelector('.bb-upload-status');

    async function uploadFiles(files) {
        if (!files || !files.length) return;
        const fd = new FormData();
        Array.from(files).forEach(f => fd.append('images', f, f.name));
        uploadStatus.textContent = `Laddar upp ${files.length} bild${files.length === 1 ? '' : 'er'}...`;
        try {
            const res = await adminFetch(`${API_BASE}/api/boat_brands/${brand.id}/images`, { method: 'POST', body: fd });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            brand.images = [...(brand.images || []), ...(data.images || [])];
            renderBoatBrandImages(card, brand);
            card.querySelector('.bb-images label').textContent = `Bilder (${brand.images.length})`;
            uploadStatus.textContent = `${(data.images || []).length} bild${(data.images || []).length === 1 ? '' : 'er'} uppladdade.`;
            setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
        } catch (err) {
            uploadStatus.textContent = 'Fel vid uppladdning: ' + (err.message || err);
        }
    }

    fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-drag'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-drag');
        uploadFiles(e.dataTransfer.files);
    });
}

async function saveBoatBrand(card, brand, status) {
    const name = card.querySelector('.bb-name').value;
    const sort = parseInt(card.querySelector('.bb-sort').value, 10) || 0;
    const description = card.querySelector('.bb-description').value;
    const mfrRaw = card.querySelector('.bb-manufacturer').value;
    const manufacturer_id = mfrRaw ? parseInt(mfrRaw, 10) : null;
    try {
        const res = await adminFetch(`${API_BASE}/api/boat_brands/${brand.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, sort_order: sort, description, manufacturer_id })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const updated = await res.json();
        brand.name = updated.name;
        brand.description = updated.description;
        brand.sort_order = updated.sort_order;
        brand.manufacturer_id = updated.manufacturer_id;
        const cached = boatBrandsCache.find(b => b.id === brand.id);
        if (cached) {
            cached.name = updated.name;
            cached.manufacturer_id = updated.manufacturer_id;
        }
        status.textContent = 'Sparat ✓';
        status.classList.add('is-saved');
        setTimeout(() => { status.textContent = ''; status.classList.remove('is-saved'); }, 2000);
    } catch (err) {
        status.textContent = 'Fel: ' + (err.message || err);
        status.classList.add('is-error');
    }
}

async function addBoatBrand() {
    try {
        const res = await adminFetch(`${API_BASE}/api/boat_brands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Ny dynsats', description: '', sort_order: boatBrandsCache.length })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const brand = await res.json();
        boatBrandsCache.push(brand);
        renderBoatBrands();
        document.getElementById('bb-list').lastElementChild?.querySelector('.bb-name')?.focus();
    } catch (err) {
        alert('Kunde inte skapa märke: ' + (err.message || err));
    }
}

$(document).on('click', '#bb-add-btn', addBoatBrand);

function updateStatusSummaryCards() {
    const row = $('#status-summary-row');
    if (!row.length) return;
    row.empty();

    getWorkflowStatuses().slice(0, 4).forEach((status, index) => {
        const card = $('<div>').addClass('stat-card');
        if (STATUS_SUMMARY_CARD_CLASSES[index]) {
            card.addClass(STATUS_SUMMARY_CARD_CLASSES[index]);
        }
        card.append(
            $('<div>').addClass('stat-label').text(status.name),
            $('<div>').addClass('stat-value').attr('id', `stat-${status.id}`).text('0'),
            $('<div>').addClass('stat-hint').text(STATUS_SUMMARY_HINTS[index] || 'Överblick')
        );
        row.append(card);
    });
}

function updateStatusSummaryCounts() {
    getWorkflowStatuses().slice(0, 4).forEach(status => {
        const target = document.getElementById(`stat-${status.id}`);
        if (!target) return;
        target.textContent = String((statusItems[status.id] || []).length);
    });

    let unreadCount = 0;
    getStatusBuckets().forEach(statusId => {
        (statusItems[statusId] || []).forEach(item => {
            if (item && item.is_form_submission && !item.read) unreadCount += 1;
        });
    });
    document.title = unreadCount > 0
        ? `(${unreadCount}) Admin · Henricssons Båtkapell`
        : 'Admin · Henricssons Båtkapell';
}

function renderStatusBoardLayout() {
    const workflowRoot = $('#status-folders-workflow');
    if (!workflowRoot.length) return;

    workflowRoot.empty();
    getWorkflowStatuses().forEach(status => {
        const card = $('<div>')
            .addClass('status-folder')
            .attr('data-status', status.id)
            .css('--status-accent', getStatusColor(status.id));

        const header = $('<div>').addClass('status-folder-top');
        const titleWrap = $('<div>').addClass('status-folder-title-wrap');
        titleWrap.append($('<h3>').text(status.name));

        if (status.id === 'nya-inskick') {
            titleWrap.append(
                $('<button>')
                    .attr('type', 'button')
                    .attr('id', 'nya-inskick-sort-btn')
                    .addClass('btn-ghost status-sort-btn')
                    .text('Nyaste först')
                    .on('click', toggleNyaInskickSort)
            );
        }

        header.append(titleWrap);
        card.append(header);
        card.append($('<div>').addClass('folder-items').attr('id', `folder-${status.id}`));
        card.append($('<button>').addClass('add-item-btn').attr('type', 'button').attr('data-status', status.id).text('+ Lägg till'));
        workflowRoot.append(card);
    });

    $('#status-folder-todo').css('--status-accent', getStatusColor(TODO_STATUS.id));
    updateSortButton();
}

function getStatusItemCount(statusId) {
    return Array.isArray(statusItems[statusId]) ? statusItems[statusId].length : 0;
}

function openStatusConfigModal() {
    statusConfigDraft = getWorkflowStatuses().map(status => ({
        clientId: status.id,
        id: status.id,
        name: status.name,
        fixed: status.id === 'nya-inskick'
    }));
    renderStatusConfigDraftList();
    $('#status-config-modal').addClass('active');
}

function closeStatusConfigModal() {
    $('#status-config-modal').removeClass('active');
}

function moveStatusDraftItem(clientId, direction) {
    const index = statusConfigDraft.findIndex(status => status.clientId === clientId);
    if (index <= 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex <= 0 || targetIndex >= statusConfigDraft.length) return;
    const [item] = statusConfigDraft.splice(index, 1);
    statusConfigDraft.splice(targetIndex, 0, item);
    renderStatusConfigDraftList();
}

function removeStatusDraftItem(clientId) {
    const index = statusConfigDraft.findIndex(status => status.clientId === clientId);
    if (index < 0) return;
    const status = statusConfigDraft[index];
    if (status.fixed) return;
    if (status.id && getStatusItemCount(status.id) > 0) {
        showStatusMessage('Mappen måste vara tom innan du kan ta bort den');
        return;
    }
    statusConfigDraft.splice(index, 1);
    renderStatusConfigDraftList();
}

function renderStatusConfigDraftList() {
    const list = $('#status-config-list');
    if (!list.length) return;
    list.empty();

    statusConfigDraft.forEach((status, index) => {
        const row = $('<div>').addClass('status-config-row');
        if (status.fixed) row.addClass('is-fixed');

        const input = $('<input>')
            .attr('type', 'text')
            .addClass('status-config-input')
            .val(status.name)
            .prop('disabled', status.fixed)
            .attr('placeholder', 'Namn på status');
        input.on('input', function() {
            status.name = sanitizeStatusName($(this).val());
        });

        const actions = $('<div>').addClass('status-config-row-actions');
        actions.append(
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-move-btn')
                .text('↑')
                .prop('disabled', status.fixed || index <= 1)
                .on('click', function() { moveStatusDraftItem(status.clientId, 'up'); }),
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-move-btn')
                .text('↓')
                .prop('disabled', status.fixed || index >= statusConfigDraft.length - 1)
                .on('click', function() { moveStatusDraftItem(status.clientId, 'down'); }),
            $('<button>')
                .attr('type', 'button')
                .addClass('btn-ghost status-config-delete-btn')
                .text('×')
                .prop('disabled', status.fixed)
                .on('click', function() { removeStatusDraftItem(status.clientId); })
        );

        const itemCount = status.id ? getStatusItemCount(status.id) : 0;
        const meta = $('<div>').addClass('status-config-meta');
        meta.text(status.fixed ? 'Fast mapp' : (itemCount > 0 ? `${itemCount} objekt i mappen` : 'Tom mapp'));

        row.append(input, actions, meta);
        list.append(row);
    });
}

async function saveStatusConfigFromModal() {
    const payload = {
        statuses: statusConfigDraft.map(status => ({
            id: status.fixed ? status.id : status.id,
            name: status.fixed ? getStatusDisplayName(status.id) : sanitizeStatusName(status.name)
        }))
    };

    const customStatuses = payload.statuses.filter(status => status.id !== 'nya-inskick');
    if (!customStatuses.every(status => status.name)) {
        showStatusMessage('Alla statusar måste ha namn.');
        return;
    }

    const saveBtn = $('#status-config-save-btn');
    const originalText = saveBtn.text();
    saveBtn.prop('disabled', true).text('Sparar...');

    try {
        const res = await adminFetch(`${API_BASE}/api/status_config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        workflowStatuses = normalizeWorkflowStatuses(data);
        statusItems = ensureStatusBuckets(statusItems);
        renderStatusBoardLayout();
        renderStatusFolders();
        updateStatusSummaryCards();
        saveStatusItems();
        closeStatusConfigModal();
        showStatusMessage('Statusmappar sparade');
    } catch (err) {
        console.error('Kunde inte spara statuskonfiguration', err);
        showStatusMessage('Kunde inte spara statusmapparna');
    } finally {
        saveBtn.prop('disabled', false).text(originalText);
    }
}

function initStatusConfigModal() {
    $('#status-config-open-btn').off('click').on('click', openStatusConfigModal);
    $('#status-config-close-btn, #status-config-cancel-btn').off('click').on('click', closeStatusConfigModal);
    $('#status-config-add-btn').off('click').on('click', function() {
        statusConfigDraft.push({
            clientId: `draft-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            id: '',
            name: '',
            fixed: false
        });
        renderStatusConfigDraftList();
    });
    $('#status-config-save-btn').off('click').on('click', saveStatusConfigFromModal);
    $('#status-config-modal')
        .off('mousedown.statusConfig mouseup.statusConfig click.statusConfig')
        .on('mousedown.statusConfig', function(e) {
            this.dataset.backdropPressStarted = $(e.target).is('#status-config-modal') ? 'true' : 'false';
        })
        .on('mouseup.statusConfig', function(e) {
            const startedOnBackdrop = this.dataset.backdropPressStarted === 'true';
            this.dataset.backdropPressStarted = 'false';
            if (startedOnBackdrop && $(e.target).is('#status-config-modal')) {
                closeStatusConfigModal();
            }
        })
        .on('click.statusConfig', function(e) {
            if ($(e.target).is('#status-config-modal')) {
                e.preventDefault();
            }
        });
}

async function loadStatusConfig() {
    try {
        const res = await adminFetch(`${API_BASE}/api/status_config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        workflowStatuses = normalizeWorkflowStatuses(data);
    } catch (err) {
        console.error('Kunde inte ladda statuskonfiguration', err);
        workflowStatuses = cloneDefaultWorkflowStatuses();
    }
    statusItems = ensureStatusBuckets(statusItems);
    updateStatusSummaryCards();
    renderStatusBoardLayout();
}

function sortNyaInskick() {
    const savedSort = localStorage.getItem('nyaInskickSortOrder');
    if (savedSort) {
        nyaInskickSortOrder = savedSort;
    }
    (statusItems['nya-inskick'] || []).sort((a, b) => {
        const dateA = parseSubmissionDateValue(a.date || a.timestamp) || new Date(0);
        const dateB = parseSubmissionDateValue(b.date || b.timestamp) || new Date(0);
        return nyaInskickSortOrder === 'oldest' ? dateA - dateB : dateB - dateA;
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
        updateStatusSummaryCounts();
    } catch (e) {
        console.error('Kunde inte spara status items', e);
    }
}

function loadStatusItems() {
    statusFoldersLoading = true;
    renderStatusFolders();

    const normalizeStatus = (value) => isWorkflowStatus(value) ? value : 'nya-inskick';

    try {
        const saved = localStorage.getItem('statusItems');
        if (saved) {
            statusItems = ensureStatusBuckets(JSON.parse(saved));
        }
    } catch (e) {
        console.error('Kunde inte ladda status items', e);
        statusItems = ensureStatusBuckets(statusItems);
    }

    const localNonFormByStatus = ensureStatusBuckets(statusItems);
    getStatusBuckets().forEach(statusId => {
        localNonFormByStatus[statusId] = (localNonFormByStatus[statusId] || []).filter(item => !(item && item.is_form_submission));
    });

    adminFetch(`${API_BASE}/api/get_form_submissions`)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(submissions => {
            const formItemsByStatus = ensureStatusBuckets({});
            if (Array.isArray(submissions)) {
                submissions.forEach(submission => {
                    const statusId = normalizeStatus(submission.status);
                    formItemsByStatus[statusId].push({
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
            getStatusBuckets().forEach(statusId => {
                statusItems[statusId] = [...(formItemsByStatus[statusId] || []), ...(localNonFormByStatus[statusId] || [])];
            });

            sortNyaInskick();
            saveStatusItems();
            statusFoldersLoading = false;
            renderStatusFolders();
        })
        .catch(err => {
            console.error('Kunde inte ladda form submissions', err);
            statusItems = ensureStatusBuckets(statusItems);
            statusFoldersLoading = false;
            renderStatusFolders();
        });
}

function renderStatusFolders() {
    renderStatusBoardLayout();

    getStatusBuckets().forEach(statusId => {
        const folderDiv = $(`#folder-${statusId}`);
        if (!folderDiv.length) return;
        folderDiv.empty();
        folderDiv.attr('data-status', statusId).addClass('droppable-folder');

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

        let itemsToShow = statusItems[statusId] || [];
        if (currentFormFilter !== 'all') {
            itemsToShow = itemsToShow.filter(item => {
                if (item.is_form_submission) {
                    return item.form_type === currentFormFilter;
                }
                return true;
            });
        }
        if (statusBoardSearchQuery) {
            itemsToShow = itemsToShow.filter(item => submissionMatchesSearch(item, statusBoardSearchQuery));
        }

        if (itemsToShow.length === 0) {
            const emptyDiv = $('<div>').addClass('folder-item folder-item-empty').css({
                textAlign: 'center',
                color: '#666',
                fontStyle: 'italic',
                padding: '2rem 1rem'
            });
            const statusName = getStatusDisplayName(statusId).toLowerCase();
            if (statusBoardSearchQuery) {
                emptyDiv.text(`Inga träffar i ${statusName}`);
            } else {
                emptyDiv.text(currentFormFilter === 'all'
                    ? `Inga ${statusName} att visa`
                    : `Inga ${currentFormFilter.toLowerCase()} i ${statusName}`);
            }
            folderDiv.append(emptyDiv);
        } else {
            itemsToShow.forEach(item => {
                const index = (statusItems[statusId] || []).indexOf(item);

                const itemDiv = $('<div>')
                    .addClass('folder-item')
                    .attr({
                        'data-index': index,
                        'data-status': statusId,
                        draggable: 'true'
                    });

                if (item.is_form_submission) {
                    itemDiv.addClass('form-submission-item');
                }

                const header = $('<div>').addClass('folder-item-header');
                const titleDiv = $('<div>').addClass('folder-item-title');

                if (item.is_form_submission && item.fields) {
                    const personName = getSubmissionField(item.fields, 'name', 'namn') || 'Okänd';
                    const formType = item.form_type || 'Formulär';
                    const manufacturer = getSubmissionField(item.fields, 'manufacturer', 'tillverkare');
                    const model = getSubmissionField(item.fields, 'model', 'modell');

                    const nameRow = $('<div>').addClass('person-name').text(personName);
                    if (!item.read) {
                        itemDiv.addClass('unread');
                        nameRow.append($('<span>').addClass('unread-badge').text('Ny'));
                    }
                    titleDiv.append(nameRow);
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
                    const messageText = getSubmissionField(item.fields, 'message', 'meddelande', 'beskrivning', 'description', 'ovrigt');
                    if (messageText) {
                        const snippet = String(messageText).replace(/\s+/g, ' ').trim();
                        if (snippet) {
                            titleDiv.append($('<div>').addClass('message-snippet').text(snippet.length > 140 ? snippet.slice(0, 140) + '\u2026' : snippet));
                        }
                    }
                    if (Array.isArray(item.attachments) && item.attachments.length > 0) {
                        titleDiv.append(
                            $('<div>').addClass('attachment-badge').css({
                                fontSize: '0.78rem',
                                color: '#8b6f18',
                                marginTop: '0.2rem',
                                fontWeight: '600'
                            }).text(`Bilagor: ${item.attachments.length}`)
                        );
                    }
                    if (item.date || item.timestamp) {
                        const date = parseSubmissionDateValue(item.date || item.timestamp);
                        if (date) {
                            itemDiv.append($('<div>').addClass('folder-item-content').text(formatSubmissionDateShortLabel(item.date || item.timestamp)));
                        }
                    }
                } else {
                    titleDiv.append($('<div>').addClass('person-name').text(item.title || 'Ingen titel'));
                }

                header.append(titleDiv);
                header.append($('<button>').addClass('folder-item-delete').attr('type', 'button').text('×').on('click', async function(e) {
                    e.stopPropagation();
                    if (!confirm('Ta bort detta objekt?')) return;
                    if (item.is_form_submission && item.form_id) {
                        const deleted = await deleteSubmissionOnServer(item);
                        if (!deleted) {
                            alert('Kunde inte ta bort från servern.');
                            return;
                        }
                        removeSubmissionFromAllStatuses(item.form_id);
                    } else {
                        (statusItems[statusId] || []).splice(index, 1);
                    }
                    saveStatusItems();
                    renderStatusFolders();
                }));
                itemDiv.append(header);

                if (!item.is_form_submission) {
                    if (item.description) {
                        const desc = $('<div>').addClass('folder-item-content');
                        const shortDesc = item.description.length > 150 ? `${item.description.substring(0, 150)}...` : item.description;
                        desc.text(shortDesc);
                        itemDiv.append(desc);
                    }
                    if (item.date) {
                        itemDiv.append($('<div>').addClass('folder-item-content').text(`Datum: ${formatSubmissionDateOnly(item.date)}`));
                    }
                }

                itemDiv.on('click', function() {
                    if (item.is_form_submission) {
                        viewFormSubmission(statusId, index);
                    } else {
                        editStatusItem(statusId, index);
                    }
                });

                itemDiv.on('dragstart', handleDragStart);
                itemDiv.on('dragend', handleDragEnd);
                folderDiv.append(itemDiv);
            });
        }

        folderDiv.off('dragover dragleave drop').on('dragover', handleDragOver).on('dragleave', handleDragLeave).on('drop', handleDrop);
    });

    updateSortButton();
    updateStatusSummaryCounts();
}

function getStatusDisplayName(statusId) {
    if (statusId === TODO_STATUS.id) return TODO_STATUS.name;
    const match = getWorkflowStatuses().find(item => item.id === statusId);
    return match ? match.name : statusId;
}

async function handleDrop(e) {
    e.preventDefault();
    $(this).removeClass('drag-over');

    const targetStatus = $(this).attr('data-status');
    if (targetStatus === draggedFromStatus) {
        return;
    }

    const item = statusItems[draggedFromStatus]?.[draggedItemIndex];
    if (!item) return;
    if (item.is_form_submission && !isWorkflowStatus(targetStatus)) {
        showStatusMessage('Formulärärenden kan inte flyttas till To-do');
        return;
    }

    const originalFromStatus = draggedFromStatus;
    const originalIndex = draggedItemIndex;

    statusItems[originalFromStatus].splice(originalIndex, 1);
    if (!statusItems[targetStatus]) {
        statusItems[targetStatus] = [];
    }
    statusItems[targetStatus].push(item);
    saveStatusItems();
    renderStatusFolders();
    showStatusMessage(`Objekt flyttat till "${getStatusDisplayName(targetStatus)}"`);

    if (!item.is_form_submission) {
        return;
    }

    const updated = await updateSubmissionStatusOnServer(item, targetStatus, item.read === true);
    if (updated) {
        return;
    }

    statusItems[targetStatus] = (statusItems[targetStatus] || []).filter(candidate => candidate !== item);
    if (!statusItems[originalFromStatus]) {
        statusItems[originalFromStatus] = [];
    }
    statusItems[originalFromStatus].splice(Math.min(originalIndex, statusItems[originalFromStatus].length), 0, item);
    saveStatusItems();
    renderStatusFolders();
    showStatusMessage('Kunde inte spara statusändringen');
}
// Archive/export installer runs after all legacy status helpers have been declared.
setTimeout(function installArchiveAndExportTools() {
    if (typeof $ === 'undefined' || typeof ARCHIVE_STATUS === 'undefined') return;

    const originalIsWorkflowStatus = isWorkflowStatus;
    const originalRenderStatusBoardLayout = renderStatusBoardLayout;
    const originalSaveStatusItems = saveStatusItems;
    const originalHandleDrop = handleDrop;
    const originalGetStatusDisplayName = getStatusDisplayName;

    isWorkflowStatus = function(statusId) {
        return statusId === ARCHIVE_STATUS.id || originalIsWorkflowStatus(statusId);
    };

    getStatusDisplayName = function(statusId) {
        if (statusId === ARCHIVE_STATUS.id) return ARCHIVE_STATUS.name;
        return originalGetStatusDisplayName(statusId);
    };

    function getArchivedSubmissions() {
        return (statusItems[ARCHIVE_STATUS.id] || []).filter(item => item && item.is_form_submission);
    }

    function updateArchiveCount() {
        $('#archive-count').text(String(getArchivedSubmissions().length));
    }

    function closeStatusFolderMenus() {
        $('.status-folder-menu').removeClass('active');
        $('.status-folder-menu-btn').attr('aria-expanded', 'false');
    }

    function createStatusFolderMenu(statusId) {
        const menuWrap = $('<div>').addClass('status-folder-menu-wrap');
        const menuBtn = $('<button>')
            .attr({
                type: 'button',
                class: 'status-folder-menu-btn',
                'aria-label': 'Mappmeny',
                'aria-expanded': 'false',
                'data-status': statusId
            });
        const menu = $('<div>').addClass('status-folder-menu').attr('data-status-menu', statusId);
        menu.append($('<button>').attr({ type: 'button', 'data-export-status': statusId }).text('Exportera Excel'));
        menuWrap.append(menuBtn, menu);
        return menuWrap;
    }

    function decorateStatusFolders() {
        getWorkflowStatuses().forEach(status => {
            const header = $(`.status-folder[data-status="${status.id}"] .status-folder-top`);
            if (header.length && !header.find('.status-folder-menu-wrap').length) {
                header.append(createStatusFolderMenu(status.id));
            }
        });

        $('#archive-drop-zone')
            .attr('data-status', ARCHIVE_STATUS.id)
            .addClass('droppable-folder')
            .off('dragover.archiveDrop dragleave.archiveDrop drop.archiveDrop')
            .on('dragover.archiveDrop', handleDragOver)
            .on('dragleave.archiveDrop', handleDragLeave)
            .on('drop.archiveDrop', handleDrop);
        updateArchiveCount();
    }

    renderStatusBoardLayout = function() {
        originalRenderStatusBoardLayout();
        decorateStatusFolders();
    };

    saveStatusItems = function() {
        originalSaveStatusItems();
        updateArchiveCount();
    };

    handleDrop = function(e) {
        const targetStatus = $(this).attr('data-status');
        const item = statusItems[draggedFromStatus]?.[draggedItemIndex];
        if (targetStatus === ARCHIVE_STATUS.id && item && !item.is_form_submission) {
            e.preventDefault();
            $(this).removeClass('drag-over');
            showStatusMessage('Endast formulÃ¤rÃ¤renden kan arkiveras');
            return;
        }
        return originalHandleDrop.call(this, e);
    };

    function formatSubmissionDateForDisplay(item) {
        return formatSubmissionDateTime(item.date || item.timestamp);
    }

    function getArchiveSearchText(item) {
        const parts = [item.title, item.description, item.form_type, item.category, item.notes, item.proposed_response, formatSubmissionDateForDisplay(item)];
        if (item.fields && typeof item.fields === 'object') {
            Object.entries(item.fields).forEach(([key, value]) => parts.push(key, value));
        }
        return parts.filter(Boolean).join(' ').toLowerCase();
    }

    function renderArchiveModalList() {
        const list = $('#archive-list');
        if (!list.length) return;
        const query = String($('#archive-search').val() || '').trim().toLowerCase();
        const archived = getArchivedSubmissions();
        const matches = query ? archived.filter(item => getArchiveSearchText(item).includes(query)) : archived;

        list.empty();
        if (!matches.length) {
            list.append($('<div>').addClass('archive-empty').text(query ? 'Inga trÃ¤ffar i arkivet' : 'Arkivet Ã¤r tomt'));
            return;
        }

        matches.forEach(item => {
            const index = (statusItems[ARCHIVE_STATUS.id] || []).indexOf(item);
            const fields = item.fields || {};
            const personName = getSubmissionField(fields, 'name', 'namn') || item.title || 'OkÃ¤nd';
            const manufacturer = getSubmissionField(fields, 'manufacturer', 'tillverkare');
            const model = getSubmissionField(fields, 'model', 'modell');
            const email = getSubmissionField(fields, 'email', 'epost', 'e-postadress');
            const phone = getSubmissionField(fields, 'phone', 'telefon', 'telefonnummer');
            const boat = [manufacturer, model].filter(Boolean).join(' ');
            const metaParts = [item.form_type, boat, email, phone, formatSubmissionDateForDisplay(item)].filter(Boolean);

            const row = $('<div>').addClass('archive-item').attr({ role: 'button', tabindex: '0', 'data-index': index });
            row.append(
                $('<div>').addClass('archive-item-title').append($('<span>').text(personName), $('<span>').text(item.form_type || '')),
                $('<div>').addClass('archive-item-meta').text(metaParts.join(' | '))
            );
            row.on('click keydown', function(e) {
                if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                viewFormSubmission(ARCHIVE_STATUS.id, index);
            });
            list.append(row);
        });
    }

    function openArchiveModal() {
        $('#archive-search').val('');
        renderArchiveModalList();
        $('#archive-modal').addClass('active');
    }

    function closeArchiveModal() {
        $('#archive-modal').removeClass('active');
    }

    function excelEscape(value) {
        return escapeHtml(String(value ?? ''));
    }

    function xmlEscape(value) {
        return String(value ?? '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function normalizeExportKey(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/Ã¥|å/g, 'a')
            .replace(/Ã¤|ä/g, 'a')
            .replace(/Ã¶|ö/g, 'o')
            .replace(/[^a-z0-9]/g, '');
    }

    function getExportFieldKeys(items) {
        const seen = new Set();
        const keys = [];
        const exportedAliases = new Set([
            'epostadress', 'emailaddress',
            'phonenumber',
            'boatbrand', 'batmarke',
            'boatmodel', 'batmodell',
            'ovriginformation',
            'name', 'namn',
            'email', 'epost', 'e_post', 'e-post', 'e-postadress',
            'phone', 'telefon', 'telefonnummer',
            'manufacturer', 'tillverkare', 'boat_brand', 'bÃ¥tmÃ¤rke',
            'model', 'modell', 'boat_model', 'bÃ¥tmodell',
            'subject', 'amne', 'Ã¤mne',
            'message', 'meddelande', 'ovrig_information', 'ovrig information', 'Ã¶vrig information'
        ]);
        items.forEach(item => {
            const fields = item.fields && typeof item.fields === 'object' ? item.fields : {};
            Object.keys(fields).forEach(key => {
                const normalizedKey = normalizeExportKey(key);
                const normalizedLabel = normalizeExportKey(getSubmissionFieldLabel(key));
                if (
                    String(key).startsWith('__') ||
                    exportedAliases.has(normalizedKey) ||
                    exportedAliases.has(normalizedLabel) ||
                    seen.has(normalizedKey) ||
                    seen.has(normalizedLabel)
                ) return;
                seen.add(normalizedKey);
                seen.add(normalizedLabel);
                keys.push(key);
            });
        });
        return keys;
    }

    function buildSubmissionExportRows(items) {
        const submissions = (items || []).filter(item => item && item.is_form_submission);
        const fieldKeys = getExportFieldKeys(submissions);
        const baseColumns = [
            { label: 'Formulär', value: item => item.form_type || '' },
            { label: 'Namn', value: item => getSubmissionField(item.fields, 'name', 'namn') },
            { label: 'E-post', value: item => getSubmissionField(item.fields, 'email', 'epost', 'e-postadress') },
            { label: 'Telefon', value: item => getSubmissionField(item.fields, 'phone', 'telefon', 'telefonnummer') },
            { label: 'Tillverkare', value: item => getSubmissionField(item.fields, 'manufacturer', 'tillverkare') },
            { label: 'Modell', value: item => getSubmissionField(item.fields, 'model', 'modell') },
            { label: 'Ämne', value: item => getSubmissionField(item.fields, 'subject', 'ämne', 'amne') },
            { label: 'Meddelande', value: item => getSubmissionField(item.fields, 'message', 'meddelande', 'övrig information', 'ovrig information') },
            { label: 'Datum', value: item => formatSubmissionDateForDisplay(item) },
            { label: 'Anteckningar', value: item => item.notes || '' },
            { label: 'Bilagor', value: item => Array.isArray(item.attachments) ? item.attachments.length : 0 },
            { label: 'ID', value: item => item.form_id || '' }
        ];
        const fieldColumns = fieldKeys.map(key => ({
            label: getSubmissionFieldLabel(key),
            value: item => item.fields && item.fields[key] !== undefined ? item.fields[key] : ''
        }));
        return { columns: [...baseColumns, ...fieldColumns], rows: submissions };
    }

    function downloadSubmissionsExcel(items, title, filenameBase) {
        const { columns, rows } = buildSubmissionExportRows(items);
        if (!rows.length) {
            showStatusMessage('Inga formulärärenden att exportera');
            return;
        }
        const sheetName = xmlEscape(String(title || 'Export').slice(0, 31));
        const columnWidths = columns.map(column => {
            const label = String(column.label || '').toLowerCase();
            if (label === 'meddelande' || label === 'anteckningar') return 220;
            if (label === 'id') return 150;
            if (label === 'e-post') return 170;
            if (label === 'datum') return 115;
            if (label === 'formulär') return 105;
            if (label === 'bilagor') return 55;
            return 100;
        });
        const columnXml = columnWidths.map(width => `<Column ss:Width="${width}"/>`).join('');
        const headerCells = columns
            .map(column => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(column.label)}</Data></Cell>`)
            .join('');
        const rowXml = rows.map((item, rowIndex) => {
            const styleId = rowIndex % 2 === 0 ? 'Text' : 'TextAlt';
            return `<Row>${columns.map(column => `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${xmlEscape(column.value(item))}</Data></Cell>`).join('')}</Row>`;
        }).join('');
        const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0C1A2B" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="Text">
   <NumberFormat ss:Format="@"/>
   <Alignment ss:Vertical="Top" ss:WrapText="0"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="TextAlt">
   <NumberFormat ss:Format="@"/>
   <Alignment ss:Vertical="Top" ss:WrapText="0"/>
   <Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="${sheetName}">
  <Table>
   ${columnXml}
   <Row>${headerCells}</Row>
   ${rowXml}
  </Table>
 </Worksheet>
</Workbook>`;
        const blob = new Blob(['\ufeff', workbookXml], { type: 'application/xml;charset=utf-8' });
        const link = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        link.href = URL.createObjectURL(blob);
        link.download = `${slugifyStatusId(filenameBase || title) || 'export'}-${stamp}.xml`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    function exportStatusToExcel(statusId) {
        const items = (statusItems[statusId] || []).map(item => ({ ...item, __statusId: statusId }));
        downloadSubmissionsExcel(items, getStatusDisplayName(statusId), getStatusDisplayName(statusId));
    }

    function exportArchiveToExcel() {
        const items = getArchivedSubmissions().map(item => ({ ...item, __statusId: ARCHIVE_STATUS.id }));
        downloadSubmissionsExcel(items, 'Arkiv', 'arkiv');
    }

    $(document)
        .off('click.statusFolderMenu')
        .on('click.statusFolderMenu', '.status-folder-menu-btn', function(e) {
            e.stopPropagation();
            const btn = $(this);
            const menu = btn.siblings('.status-folder-menu');
            const isActive = menu.hasClass('active');
            closeStatusFolderMenus();
            if (!isActive) {
                menu.addClass('active');
                btn.attr('aria-expanded', 'true');
            }
        })
        .on('click.statusFolderMenu', '[data-export-status]', function(e) {
            e.stopPropagation();
            closeStatusFolderMenus();
            exportStatusToExcel($(this).attr('data-export-status'));
        })
        .on('click.statusFolderMenu', function() {
            closeStatusFolderMenus();
        });

    $(document)
        .off('click.archiveModal input.archiveModal')
        .on('click.archiveModal', '#archive-open-btn', openArchiveModal)
        .on('click.archiveModal', '#archive-close-btn', closeArchiveModal)
        .on('click.archiveModal', '#archive-export-btn', exportArchiveToExcel)
        .on('input.archiveModal', '#archive-search', renderArchiveModalList)
        .on('click.archiveModal', '#archive-modal', function(e) {
            if ($(e.target).is('#archive-modal')) closeArchiveModal();
        });

    decorateStatusFolders();
}, 0);

function moveStatusDraftClientId(clientId, targetIndex) {
    const index = statusConfigDraft.findIndex(status => status.clientId === clientId);
    if (index <= 0) return;
    const status = statusConfigDraft[index];
    if (!status || status.fixed) return;
    const boundedIndex = Math.max(1, Math.min(targetIndex, statusConfigDraft.length - 1));
    if (boundedIndex === index) return;
    const [item] = statusConfigDraft.splice(index, 1);
    statusConfigDraft.splice(boundedIndex, 0, item);
    renderStatusConfigDraftList();
}

function reorderStatusDraftClientId(clientId, targetIndex) {
    const index = statusConfigDraft.findIndex(status => status.clientId === clientId);
    if (index <= 0) return index;
    const status = statusConfigDraft[index];
    if (!status || status.fixed) return index;
    const boundedIndex = Math.max(1, Math.min(targetIndex, statusConfigDraft.length - 1));
    if (boundedIndex === index) return index;
    const [item] = statusConfigDraft.splice(index, 1);
    statusConfigDraft.splice(boundedIndex, 0, item);
    return boundedIndex;
}

function syncStatusDraftOrderFromDom(list) {
    const order = $(list).children('.status-config-row').map(function() {
        return this.dataset.clientId || '';
    }).get();
    const itemsById = new Map(statusConfigDraft.map(status => [status.clientId, status]));
    statusConfigDraft = order.map(clientId => itemsById.get(clientId)).filter(Boolean);
}

function renderStatusConfigDraftList() {
    const list = $('#status-config-list');
    if (!list.length) return;
    list.empty();
    list.off('dragover.statusConfigList drop.statusConfigList');

    statusConfigDraft.forEach((status, index) => {
        const row = $('<div>')
            .addClass('status-config-row')
            .attr('data-client-id', status.clientId || '');
        if (status.fixed) {
            row.addClass('is-fixed');
        } else {
            row.attr('draggable', 'true');
        }

        const input = $('<input>')
            .attr('type', 'text')
            .addClass('status-config-input')
            .val(status.name)
            .prop('disabled', status.fixed)
            .attr('placeholder', 'Namn på status');
        input.on('input', function() {
            status.name = sanitizeStatusName($(this).val());
        });

        if (!status.fixed) {
            row
                .on('dragstart', function(e) {
                    const event = e.originalEvent;
                    if (!event || !event.dataTransfer) return;
                    list.attr('data-dragging-client-id', status.clientId);
                    row.addClass('is-dragging');
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', status.clientId);
                })
                .on('dragend', function() {
                    list.removeAttr('data-dragging-client-id');
                    list.find('.status-config-row').removeClass('is-dragging is-drop-target-before is-drop-target-after');
                });
        }

        const main = $('<div>').addClass('status-config-main');
        if (!status.fixed) {
            main.append(
                $('<div>')
                    .addClass('status-config-drag-handle')
                    .attr('aria-hidden', 'true')
            );
        }
        main.append(input);

        const actions = $('<div>').addClass('status-config-row-actions');
        if (!status.fixed) {
            actions.append(
                $('<button>')
                    .attr('type', 'button')
                    .addClass('btn-ghost status-config-delete-btn')
                    .text('×')
                    .on('click', function() { removeStatusDraftItem(status.clientId); })
            );
        }

        const itemCount = status.id ? getStatusItemCount(status.id) : 0;
        const meta = $('<div>').addClass('status-config-meta');
        meta.text(status.fixed ? 'Fast mapp' : (itemCount > 0 ? `${itemCount} objekt i mappen` : 'Tom mapp'));

        row.append(main, actions, meta);
        list.append(row);
    });

    list
        .on('dragover.statusConfigList', function(e) {
            const draggingId = list.attr('data-dragging-client-id');
            if (!draggingId) return;
            e.preventDefault();
            const event = e.originalEvent;
            if (!event) return;
            const draggedRow = list.children(`.status-config-row[data-client-id="${draggingId}"]`).get(0);
            if (!draggedRow) return;
            const candidates = list.children('.status-config-row[draggable="true"]').not(`[data-client-id="${draggingId}"]`).get();
            let insertBefore = null;
            for (const candidate of candidates) {
                const rect = candidate.getBoundingClientRect();
                if (event.clientY < rect.top + (rect.height / 2)) {
                    insertBefore = candidate;
                    break;
                }
            }
            if (insertBefore) {
                this.insertBefore(draggedRow, insertBefore);
            } else {
                this.appendChild(draggedRow);
            }
            syncStatusDraftOrderFromDom(this);
        })
        .on('drop.statusConfigList', function(e) {
            const draggingId = list.attr('data-dragging-client-id');
            if (!draggingId) return;
            e.preventDefault();
        });
}
