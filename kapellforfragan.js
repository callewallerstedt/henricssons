if (!window.boatData || typeof window.boatData !== 'object') {
    window.boatData = {};
}

const port = '25565';
const DATA_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? `${location.protocol}//${location.hostname}:${port}`
    : 'https://henricssons-api.onrender.com';

const state = {
    manufacturers: [],
    selectedManufacturerKey: '',
    selectedModelName: '',
    searchTerm: '',
    refreshTimer: null,
    elements: {}
};

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    bindEvents();

    loadBoatData({ showAlertOnFailure: true }).finally(() => {
        preselectFormFields();

        if (!state.refreshTimer) {
            state.refreshTimer = setInterval(refreshBoatData, 30000);
        }
    });
});

function cacheElements() {
    state.elements = {
        searchInput: document.getElementById('tillverkare'),
        clearSearch: document.getElementById('clear-qs'),
        manufacturerGrid: document.querySelector('.grid1'),
        modelGrid: document.querySelector('.grid2'),
        modelContainer: document.getElementById('modell-container'),
        manufacturerField: document.getElementById('T-field'),
        modelField: document.getElementById('M-field'),
        clearManufacturer: document.getElementById('rensa-grid1'),
        clearModel: document.getElementById('rensa-grid2'),
        contactForm: document.getElementById('contact-form')
    };

    if (state.elements.clearSearch) {
        state.elements.clearSearch.textContent = 'Rensa sök';
    }
}

function bindEvents() {
    const {
        searchInput,
        clearSearch,
        clearManufacturer,
        clearModel,
        manufacturerGrid,
        modelGrid
    } = state.elements;

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            state.searchTerm = state.elements.searchInput.value.trim();
            renderManufacturers();
            updateActions();
        }, 120));
    }

    if (clearSearch) {
        clearSearch.addEventListener('click', () => {
            state.searchTerm = '';
            state.elements.searchInput.value = '';
            renderManufacturers();
            updateActions();
        });
    }

    if (clearManufacturer) {
        clearManufacturer.addEventListener('click', (event) => {
            event.preventDefault();
            clearManufacturerSelection();
        });
    }

    if (clearModel) {
        clearModel.addEventListener('click', (event) => {
            event.preventDefault();
            clearModelSelection();
        });
    }

    if (manufacturerGrid) {
        manufacturerGrid.addEventListener('click', (event) => {
            const item = event.target.closest('.grid1-item');
            if (!item) {
                return;
            }

            selectManufacturer(item.dataset.key, { scrollToModels: true });
        });
    }

    if (modelGrid) {
        modelGrid.addEventListener('click', (event) => {
            const item = event.target.closest('.grid2-item');
            if (!item) {
                return;
            }

            selectModel(item.dataset.modelName, { scrollToForm: true });
        });
    }
}

async function loadBoatData({ showAlertOnFailure = false } = {}) {
    try {
        const payload = await fetchBoatData(Date.now());
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid boat data payload');
        }

        window.boatData = payload;
        syncManufacturers();
        renderManufacturers();
        renderModels();
        updateActions();
    } catch (error) {
        console.error('Fel vid hämtning av boat_data.json', error);
        if (showAlertOnFailure) {
            alert('Kunde inte hämta båtdata just nu.');
        }
    }
}

async function fetchBoatData(cacheBuster) {
    const urls = [
        `${DATA_BASE}/boat_data.json?v=${cacheBuster}`,
        `boat_data.json?v=${cacheBuster}`
    ];

    for (const url of urls) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (response.ok) {
                return response.json();
            }
        } catch (error) {
            console.debug('Kunde inte läsa', url, error);
        }
    }

    if (window.boatData && Object.keys(window.boatData).length > 0) {
        return window.boatData;
    }

    throw new Error('boat_data.json could not be loaded');
}

function syncManufacturers() {
    const boatData = window.boatData || {};

    state.manufacturers = Object.keys(boatData)
        .map((key) => {
            const entry = boatData[key];
            if (!entry || typeof entry.name !== 'string' || !Array.isArray(entry.models)) {
                return null;
            }

            const models = entry.models
                .map((model) => (typeof model === 'string' ? model : model && typeof model.name === 'string' ? model.name : ''))
                .filter(Boolean)
                .sort((left, right) => left.localeCompare(right, 'sv', { sensitivity: 'base' }));

            return {
                key,
                name: entry.name.trim(),
                models
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name, 'sv', { sensitivity: 'base' }));

    const selectedManufacturer = getSelectedManufacturer();
    if (!selectedManufacturer) {
        state.selectedManufacturerKey = '';
        state.selectedModelName = '';
        state.elements.manufacturerField.value = '';
        state.elements.modelField.value = '';
        state.elements.modelContainer.classList.add('inaktiv');
        return;
    }

    state.elements.manufacturerField.value = selectedManufacturer.name;

    if (!selectedManufacturer.models.includes(state.selectedModelName)) {
        state.selectedModelName = '';
        state.elements.modelField.value = '';
    }
}

function renderManufacturers() {
    const grid = state.elements.manufacturerGrid;
    if (!grid) {
        return;
    }

    grid.innerHTML = '';

    const term = normalizeText(state.searchTerm);
    const matches = state.manufacturers.filter((manufacturer) => {
        return !term || normalizeText(manufacturer.name).includes(term);
    });

    if (matches.length === 0) {
        grid.appendChild(createEmptyState('Ingen tillverkare matchar sökningen.'));
        return;
    }

    matches.forEach((manufacturer) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'grid1-item';
        button.dataset.key = manufacturer.key;
        button.textContent = manufacturer.name;

        if (manufacturer.key === state.selectedManufacturerKey) {
            button.classList.add('selected-t');
        }

        grid.appendChild(button);
    });
}

function renderModels() {
    const grid = state.elements.modelGrid;
    const container = state.elements.modelContainer;

    if (!grid || !container) {
        return;
    }

    grid.innerHTML = '';

    const selectedManufacturer = getSelectedManufacturer();
    if (!selectedManufacturer) {
        container.classList.add('inaktiv');
        return;
    }

    container.classList.remove('inaktiv');

    if (selectedManufacturer.models.length === 0) {
        grid.appendChild(createEmptyState('Det finns inga modeller registrerade för den här tillverkaren än.'));
        return;
    }

    selectedManufacturer.models.forEach((modelName) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'grid2-item';
        button.dataset.modelName = modelName;
        button.textContent = modelName;

        if (modelName === state.selectedModelName) {
            button.classList.add('selected-m');
        }

        grid.appendChild(button);
    });
}

function createEmptyState(message) {
    const item = document.createElement('div');
    item.className = 'grid-empty';
    item.textContent = message;
    return item;
}

function selectManufacturer(key, { scrollToModels = false } = {}) {
    const manufacturer = state.manufacturers.find((item) => item.key === key);
    if (!manufacturer) {
        return;
    }

    state.selectedManufacturerKey = manufacturer.key;
    state.selectedModelName = '';
    state.elements.manufacturerField.value = manufacturer.name;
    state.elements.modelField.value = '';

    renderManufacturers();
    renderModels();
    updateActions();

    if (scrollToModels) {
        scrollToElement(state.elements.modelContainer, 128);
    }
}

function clearManufacturerSelection() {
    state.selectedManufacturerKey = '';
    state.selectedModelName = '';
    state.elements.manufacturerField.value = '';
    state.elements.modelField.value = '';
    renderManufacturers();
    renderModels();
    updateActions();
}

function selectModel(modelName, { scrollToForm = false } = {}) {
    const selectedManufacturer = getSelectedManufacturer();
    if (!selectedManufacturer || !selectedManufacturer.models.includes(modelName)) {
        return;
    }

    state.selectedModelName = modelName;
    state.elements.modelField.value = modelName;
    renderModels();
    updateActions();

    if (scrollToForm) {
        scrollToElement(state.elements.contactForm, 128);
    }
}

function clearModelSelection() {
    state.selectedModelName = '';
    state.elements.modelField.value = '';
    renderModels();
    updateActions();
}

function updateActions() {
    const { clearSearch, clearManufacturer, clearModel } = state.elements;

    if (clearSearch) {
        clearSearch.classList.toggle('is-visible', Boolean(state.searchTerm));
    }

    if (clearManufacturer) {
        clearManufacturer.style.display = state.selectedManufacturerKey ? 'inline-block' : 'none';
    }

    if (clearModel) {
        clearModel.style.display = state.selectedModelName ? 'inline-block' : 'none';
    }
}

function getSelectedManufacturer() {
    return state.manufacturers.find((item) => item.key === state.selectedManufacturerKey) || null;
}

function scrollToElement(element, offset = 0) {
    if (!element) {
        return;
    }

    const top = element.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function debounce(fn, delay = 100) {
    let timeoutId = null;

    return (...args) => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => fn(...args), delay);
    };
}

function getQueryPrefill() {
    const params = new URLSearchParams(window.location.search);
    return {
        manufacturerName: params.get('manufacturer')?.trim() || '',
        modelName: params.get('model')?.trim() || '',
        examplePath: params.get('example')?.trim() || ''
    };
}

function preselectFormFields() {
    const queryPrefill = getQueryPrefill();
    const hasQueryPrefill = Boolean(queryPrefill.manufacturerName || queryPrefill.modelName || queryPrefill.examplePath);

    if (hasQueryPrefill) {
        applyDirectPrefill(queryPrefill);
        return;
    }

    preselectFromStorage();
}

function applyDirectPrefill({ manufacturerName = '', modelName = '', examplePath = '' } = {}) {
    if (manufacturerName) {
        state.elements.manufacturerField.value = manufacturerName;
    }

    if (modelName) {
        state.elements.modelField.value = modelName;
    }

    const manufacturer = state.manufacturers.find((item) => {
        return normalizeText(item.name) === normalizeText(manufacturerName);
    });

    if (manufacturer) {
        selectManufacturer(manufacturer.key, { scrollToModels: false });
        state.elements.manufacturerField.value = manufacturerName || manufacturer.name;
    } else {
        state.selectedManufacturerKey = '';
        state.selectedModelName = '';
        renderManufacturers();
        renderModels();
        updateActions();
    }

    if (modelName) {
        const selectedManufacturer = getSelectedManufacturer();
        const matchedModel = selectedManufacturer
            ? selectedManufacturer.models.find((item) => normalizeText(item) === normalizeText(modelName))
            : null;

        if (matchedModel) {
            selectModel(matchedModel, { scrollToForm: false });
        }

        state.elements.modelField.value = modelName;
    }

    if (examplePath) {
        try {
            localStorage.setItem('contactExamplePrefill', JSON.stringify({
                manufacturer: manufacturerName,
                model: modelName,
                example: examplePath
            }));
        } catch (error) {
            console.debug('Kunde inte spara exempel-prefill', error);
        }
    }
}

function preselectFromStorage() {
    const manufacturerName = localStorage.getItem('preselectManufacturer');
    const modelName = localStorage.getItem('preselectModel');

    if (!manufacturerName && !modelName) {
        return;
    }

    if (manufacturerName) {
        state.elements.manufacturerField.value = manufacturerName;
    }
    if (modelName) {
        state.elements.modelField.value = modelName;
    }

    const manufacturer = state.manufacturers.find((item) => {
        return normalizeText(item.name) === normalizeText(manufacturerName);
    });

    if (manufacturer) {
        selectManufacturer(manufacturer.key, { scrollToModels: false });

        const matchedModel = manufacturer.models.find((item) => {
            return normalizeText(item) === normalizeText(modelName);
        });

        if (matchedModel) {
            selectModel(matchedModel, { scrollToForm: false });
        } else if (modelName) {
            state.elements.modelField.value = modelName;
        }
    } else {
        state.selectedManufacturerKey = '';
        state.selectedModelName = '';
    }

    localStorage.removeItem('preselectManufacturer');
    localStorage.removeItem('preselectModel');
}

async function refreshBoatData() {
    try {
        const payload = await fetchBoatData(Date.now());
        if (!payload || typeof payload !== 'object') {
            return;
        }

        const current = JSON.stringify(window.boatData || {});
        const next = JSON.stringify(payload);
        if (current === next) {
            return;
        }

        window.boatData = payload;
        syncManufacturers();
        renderManufacturers();
        renderModels();
        updateActions();
    } catch (error) {
        console.debug('Kunde inte uppdatera boat_data.json', error);
    }
}
