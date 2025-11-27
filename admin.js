// Adminpanel för tillverkare och modeller
// Bygger grid och sökfält likt kapellförfrågan, men med redigering

let manufacturers = typeof boatData !== 'undefined' ? boatData : {};
let selectedManufacturerKey = null;
let selectedModelIndex = null;
let $grid1, $grid2;

// Lägg in omedelbart efter globala variabler
// Auto-detect API base URL based on current location
let API_BASE;
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // Use current port from the page URL, or default to 25565
    const port = location.port || '25565';
    API_BASE = `${location.protocol}//${location.hostname}:${port}`;
} else {
    API_BASE = 'https://henricssons-api.onrender.com';
}
console.log('API_BASE initialized to:', API_BASE, 'from location:', location.href);

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

// Dashboard variables
let calendar = null;
let statusItems = {
    'nya-inskick': [],
    'vantar-pa-svar': [],
    'i-produktion': [],
    'redo-for-leverans': []
};
let nyaInskickSortOrder = 'newest'; // 'newest' or 'oldest'
let chatbotPrompt = 'Du är en hjälpsam assistent för Henricssons Båtkapell. Du hjälper till med frågor om båtkapell, beställningar och allmän service.';
let currentEditingItem = null;

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
            console.warn('Kunde inte hämta boat_data.json från API – använder ev. localStorage', err);
            try {
                const stored = localStorage.getItem('boatData');
                if(stored){ manufacturers = JSON.parse(stored); }
            } catch(e){ console.error('Fel vid parsa localStorage boatData', e); }
            buildGrids();
        });
}

function fetchExtras() {
    // Ladda allt direkt från models_meta.json och mappa till extrasData-strukturen
    return fetch(`${API_BASE}/henricssons_bilder/models_meta.json?v=${Date.now()}`)
        .then(r => r.json())
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
        })
        .catch(err => {
            console.error('Could not load models_meta.json', err);
            extrasData = {};
        });
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
    // Ingen Isotope på grid2 – vi behåller vanlig flex-layout så redigeringsrutan inte överlappas
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

    // Ingen automatisk scroll på mobil – låt användaren bläddra själv för att undvika glitch
}

function showManufacturerEdit() {
    const manu = manufacturers[selectedManufacturerKey];
    $('#edit-section').html(`
        <h2>Redigera tillverkare</h2>
        <label>Tillverkarnamn</label>
        <input type="text" id="edit-manu-name" value="${manu.name}" />
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
    ensureModelObject(selectedModelIndex);
    
    $('#edit-section').html(`
        <h2>Redigera modell</h2>
        <label>Modellnamn</label>
        <input type="text" id="edit-model-name" value="${modelName}" />
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
    $('#edit-msg').html(`<div class="${type}">${msg}</div>`);
    setTimeout(() => { $('#edit-msg').empty(); }, 2000);
}

function pushFullDataset(cb) {
    // Spara i localStorage och skicka till server
    try { 
        localStorage.setItem('boatData', JSON.stringify(manufacturers)); 
        
        // Skicka till Python-server
        fetch(`${API_BASE}/api/save_boatdata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(manufacturers)
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                showEditMsg('Kunde inte spara till fil: ' + (data.error || 'Okänt fel'), 'error');
            }
        })
        .catch(error => {
            showEditMsg('Kunde inte ansluta till server. Kör admin_server.py i en separat terminal.', 'error');
        });
        
    } catch(e){
        showEditMsg('Kunde inte spara', 'error');
    }
    cb && cb();
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

function switchTab(tab){
    activeTab = tab;
    $('.tab-btn').removeClass('active');
    $(`.tab-btn[data-tab="${tab}"]`).addClass('active');

    if(tab==='dashboard'){
        $('#dashboard-section').addClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        initDashboard();
    } else if(tab==='texts'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#texts-section').addClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        loadAnnouncementText();
        loadFormPrompts(); // Load form prompts when opening texts tab
        // Set up real-time preview update
        $('#announcement-text').off('input keyup').on('input keyup', function() {
            updateAnnouncementPreview();
        });
    } else if(tab==='calendar'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').addClass('active');
        $('#texts-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').hide();
        $('.quicksearch').hide();
        $('#admin-tabs').hide();
        $('#extras-search').hide();
        initCalendar();
    } else if(tab==='boats'){
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#boats-section').show();
        $('#extras-section').hide();
        $('.quicksearch').show();
        // Dölj sekundära flikar när vi är i tillverkar-läget
        $('#admin-tabs').hide();
        // Tvinga om-layout av Isotope om den redan initierats för att fixa fastnad animation
        if($grid1 && typeof $grid1.isotope === 'function') {
            $grid1.isotope('layout');
        }
        $('#extras-search').hide();
        editExtrasCat = null; // nollställ
    } else {
        $('#dashboard-section').removeClass('active');
        $('#calendar-section').removeClass('active');
        $('#boats-section').hide();
        $('#extras-section').show();
        $('.quicksearch').hide();
        // Visa sekundära flikar under "Bilder & exempel"
        $('#admin-tabs').css('display', 'flex');
        $('#extras-search').show();
        activeExtrasKey = tab;
        selectedExtraIndex = null;
        editExtrasCat = null;
        buildExtrasList();
        showExtrasEdit();
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
        const div = $(`<div class="extras-item ${inactiveCls} ${noImagesCls} ${isSelected?'selected-e':''}" data-index="${idx}" data-cat="${cat}" data-search="${searchStr}"><span class="extra-name">${obj.name||'–'}</span></div>`);
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
    $('#extras-edit-section').html(`
        <h2>Redigera post</h2>
        <label>Namn</label>
        <input type="text" id="extra-name" value="${obj.name||''}" />
        <div style="display:flex;flex-direction:column;gap:0rem;"> 
            <span style="color:#0a2342;font-weight:bold;">Publicerad</span>
            <label class="switch" style="align-self:flex-start;"><input type="checkbox" id="extra-published" ${obj.published!==false?'checked':''}><span class="slider"></span></label>
        </div>
        <label>Tillverkare</label>
        <input type="text" id="extra-manu" value="${obj.manufacturer||''}" />
        <label>Modell</label>
        <input type="text" id="extra-model" value="${obj.model||''}" />
        <label>Variant</label>
        <input type="text" id="extra-variant" value="${obj.variant||''}" />
        <label>Beskrivning</label>
        <textarea id="extra-desc" rows="3">${obj.description||''}</textarea>
        <label>Leveransinfo</label>
        <textarea id="extra-delivery" rows="2">${obj.delivery||''}</textarea>
        <label>Bilder</label>
        <div id="extra-images-list" class="img-thumb-list">
            ${(obj.images||[]).map((img,idx)=>`<div class="img-thumb" data-idx="${idx}" style="${idx===0?'border:2px solid #28a745;':''}"><img src="${img}" alt=""/><button class="set-thumb-btn" title="Gör thumbnail" data-idx="${idx}" style="background:#28a745;color:#fff;position:absolute;top:2px;left:2px;border:none;border-radius:3px;padding:0 4px;cursor:pointer;">★</button><button class="del-img-btn" data-idx="${idx}" style="position:absolute;top:2px;right:2px;">&times;</button></div>`).join('')}
        </div>
        <input type="file" id="upload-extra-img" accept="image/*" />
        <button class="btn" id="save-extra-btn">Spara</button>
        <button class="btn btn-danger" id="delete-extra-btn">Ta bort</button>
        <button class="btn btn-secondary" id="cancel-extra-btn">Avbryt</button>
        <div id="extras-msg"></div>
    `);

    function extrasMsg(t, cls){ $('#extras-msg').html(`<div class="${cls}">${t}</div>`); setTimeout(()=>$('#extras-msg').empty(),2000); }

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
            $(`.extras-item.selected-e .extra-name`).text(updatedObj.name || '–');
            // Behåll formuläret som det är – användaren ser sina ändringar direkt
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

            fetch(`${API_BASE}/api/upload_image`, {
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
                if(p.startsWith('data:')) return p; // behåll inline
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

    // Skicka till Python-server
    fetch(`${API_BASE}/api/save_models_meta`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(newMeta)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showEditMsg('Extras sparade!', 'success');
            setUnsaved('extras', false);
            // Ingen ombyggnad av listan behövs – lokala ändringar är redan gjorda.
            // selectedExtraIndex och editExtrasCat behålls som de är.
        } else {
            showEditMsg('Kunde inte spara till fil: ' + (data.error || 'Okänt fel'), 'error');
        }
    })
    .catch(error => {
        showEditMsg('Kunde inte ansluta till server. Kör admin_server.py i en separat terminal.', 'error');
    });
    
    cb && cb();
}

function bindExtraImageDelete(){
    $('#extra-images-list .del-img-btn').off('click').on('click', function(){
        const imgIdx=$(this).data('idx');
        if(!confirm('Ta bort denna bild?')) return;
        const catKey = activeExtrasKey==='all' ? (editExtrasCat||'motorboats') : activeExtrasKey;
        extrasData[catKey][selectedExtraIndex].images.splice(imgIdx,1);
        saveExtras(()=>{ $('#extras-msg').html('<div class="success">Bild borttagen</div>'); setTimeout(()=>$('#extras-msg').empty(),2000); showExtrasEdit(); });
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
        saveExtras(()=>{ $('#extras-msg').html('<div class="success">Thumbnail uppdaterad</div>'); setTimeout(()=>$('#extras-msg').empty(),2000); showExtrasEdit(); });
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
}

function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    
    if (calendar) {
        calendar.destroy();
    }
    
    try {
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
        'redo-for-leverans': '#4caf50'
    };
    return colors[status] || '#666';
}

function initChatbot() {
    $('#chatbot-send-btn').off('click').on('click', sendChatMessage);
    $('#chatbot-input').off('keypress').on('keypress', function(e) {
        if (e.which === 13) {
            sendChatMessage();
        }
    });
    $('#chatbot-settings-btn').off('click').on('click', function() {
        $('#chatbot-settings').toggle();
    });
    $('#save-prompt-btn').off('click').on('click', saveChatbotPrompt);
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
    
    // Debug: log API_BASE
    console.log('API_BASE:', API_BASE);
    const chatUrl = `${API_BASE}/api/chat`;
    console.log('Chat URL:', chatUrl);
    
    // Call OpenAI API
    fetch(chatUrl, {
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
        console.log('Response status:', response.status);
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
        textDiv.html(html);
    } else if (role === 'assistant') {
        // Fallback: simple markdown parsing if marked.js not available
        const html = simpleMarkdownToHtml(text);
        textDiv.html(html);
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
    
    let html = text;
    
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
    try {
        const saved = localStorage.getItem('chatbotPrompt');
        if (saved) {
            chatbotPrompt = saved;
            $('#chatbot-prompt').val(chatbotPrompt);
        }
    } catch(e) {
        console.error('Kunde inte ladda prompt', e);
    }
}

function saveChatbotPrompt() {
    chatbotPrompt = $('#chatbot-prompt').val().trim() || chatbotPrompt;
    try {
        localStorage.setItem('chatbotPrompt', chatbotPrompt);
        alert('Prompt sparad!');
    } catch(e) {
        alert('Kunde inte spara prompt');
    }
}

function loadStatusItems() {
    try {
        const saved = localStorage.getItem('statusItems');
        if (saved) {
            statusItems = JSON.parse(saved);
        }
    } catch(e) {
        console.error('Kunde inte ladda status items', e);
    }
    
    // Load form submissions from API
    fetch(`${API_BASE}/api/get_form_submissions`)
        .then(r => r.json())
        .then(submissions => {
            if (Array.isArray(submissions)) {
                // Convert form submissions to status items format
                submissions.forEach(submission => {
                    if (submission.status === 'nya-inskick' && !submission.read) {
                        // Check if this submission already exists
                        const exists = statusItems['nya-inskick'].some(item => item.form_id === submission.id);
                        if (!exists) {
                            statusItems['nya-inskick'].push({
                                form_id: submission.id,
                                title: submission.title,
                                description: submission.form_summary,
                                date: submission.timestamp,
                                category: submission.category,
                                form_type: submission.form_type,
                                fields: submission.fields,
                                proposed_response: submission.proposed_response,
                                is_form_submission: true
                            });
                        }
                    }
                });
                // Sort by date (category sorting removed, only date sorting)
                sortNyaInskick();
                saveStatusItems();
            }
            renderStatusFolders();
            updateSortButton();
        })
        .catch(err => {
            console.error('Kunde inte ladda form submissions', err);
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
        statusItems[status].forEach((item, index) => {
            const itemDiv = $('<div>').addClass('folder-item').attr('data-index', index);
            if (item.is_form_submission) {
                itemDiv.addClass('form-submission-item');
            }
            const header = $('<div>').addClass('folder-item-header');
            const titleDiv = $('<div>').addClass('folder-item-title');
            
            // For form submissions, show simplified info
            if (item.is_form_submission && item.fields) {
                const formType = item.form_type || 'Formulär';
                const manufacturer = item.fields['Tillverkare'] || item.fields['4. Tillverkare'] || '';
                const model = item.fields['Modell'] || item.fields['5. Modell'] || '';
                
                // Build display text
                let displayText = formType;
                if (manufacturer || model) {
                    const boatInfo = [manufacturer, model].filter(Boolean).join(' ');
                    if (boatInfo) {
                        displayText += ' - ' + boatInfo;
                    }
                }
                titleDiv.text(displayText);
                
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
                titleDiv.text(item.title || 'Ingen titel');
            }
            
            header.append(titleDiv);
            header.append($('<button>').addClass('folder-item-delete').text('×').on('click', function(e) {
                e.stopPropagation();
                if (confirm('Ta bort detta objekt?')) {
                    statusItems[status].splice(index, 1);
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
            folderDiv.append(itemDiv);
        });
    });
    // Update sort button after rendering
    updateSortButton();
}

function viewFormSubmission(status, index) {
    const item = statusItems[status][index];
    if (!item || !item.is_form_submission) return;
    
    // Mark as read
    item.read = true;
    saveStatusItems();
    
    // Create or update form submission modal
    let modal = $('#form-submission-modal');
    if (modal.length === 0) {
        modal = $('<div>').attr('id', 'form-submission-modal').addClass('modal');
        modal.html(`
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h2 id="form-modal-title">Formulärinlägg</h2>
                    <button class="modal-close">×</button>
                </div>
                <div class="modal-body" id="form-modal-body">
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
    $('#form-modal-title').text(item.title || 'Formulärinlägg');
    const body = $('#form-modal-body');
    body.empty();
    
    // Form details section
    const formSection = $('<div>').addClass('form-section');
    formSection.append($('<h3>').text('Formulärinformation'));
    if (item.form_type) {
        formSection.append($('<p>').html(`<strong>Typ:</strong> ${item.form_type}`));
    }
    if (item.category) {
        formSection.append($('<p>').html(`<strong>Kategori:</strong> ${item.category}`));
    }
    if (item.date) {
        formSection.append($('<p>').html(`<strong>Datum:</strong> ${new Date(item.date).toLocaleString('sv-SE')}`));
    }
    
    // Form fields
    if (item.fields) {
        formSection.append($('<h4>').text('Formulärfält:'));
        const fieldsList = $('<div>').addClass('form-fields');
        Object.keys(item.fields).forEach(key => {
            if (item.fields[key]) {
                fieldsList.append($('<div>').addClass('form-field').html(`<strong>${key}:</strong> ${item.fields[key]}`));
            }
        });
        formSection.append(fieldsList);
    }
    
    body.append(formSection);
    
    // AI Proposed Response section
    if (item.proposed_response) {
        const responseSection = $('<div>').addClass('form-section');
        responseSection.append($('<h3>').text('Föreslaget svar (AI-genererat)'));
        const responseDiv = $('<div>').addClass('proposed-response');
        // Use marked.js if available to render markdown
        if (typeof marked !== 'undefined') {
            responseDiv.html(marked.parse(item.proposed_response));
        } else {
            responseDiv.text(item.proposed_response);
        }
        responseSection.append(responseDiv);
        body.append(responseSection);
    }
    
    modal.addClass('active');
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
        } else if(prim==='calendar'){
            switchTab('calendar');
        } else if(prim==='boats'){
            switchTab('boats');
        } else {
            // Byt till "Visa alla" som standard
            const firstCat = activeExtrasKey || 'all';
            switchTab(firstCat);
        }
    });

    Promise.all([fetchManufacturers(), fetchExtras()]).then(()=>{
        switchTab('dashboard');
        $('#admin-tabs').hide(); // sekundära flikar dolda initialt
        $('#extras-search').hide();
    });

    // Tab buttons
    $(document).on('click', '.tab-btn', function(){
        switchTab($(this).data('tab'));
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
            return marked.parse(md);
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
        previewEl.html('<p style="color: #666; font-style: italic;">Förhandsvisning visas här när du skriver...</p>');
        return;
    }
    
    const html = parseMarkdownForPreview(text);
    previewEl.html(html);
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
    
    fetch(`${API_BASE}/api/page_texts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .then(result => {
        if (result.success) {
            $('#announcement-edit-success').text('Text sparad! Kom ihåg att committa ändringarna till GitHub.').show();
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
    fetch(`${API_BASE}/api/form_prompts`)
        .then(r => r.json())
        .then(data => {
            if (data.Kapellförfrågan) {
                $('#prompt-kapell').val(data.Kapellförfrågan);
            }
            if (data.Fenderförfrågan) {
                $('#prompt-fender').val(data.Fenderförfrågan);
            }
            if (data.Kontakt) {
                $('#prompt-kontakt').val(data.Kontakt);
            }
        })
        .catch(err => {
            console.error('Error loading form prompts:', err);
        });
}

function saveFormPrompts() {
    const data = {
        'Kapellförfrågan': $('#prompt-kapell').val(),
        'Fenderförfrågan': $('#prompt-fender').val(),
        'Kontakt': $('#prompt-kontakt').val()
    };
    
    fetch(`${API_BASE}/api/form_prompts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            $('#prompts-edit-success').text('Prompts sparade!').show();
            $('#prompts-edit-error').hide();
        } else {
            $('#prompts-edit-error').text('Kunde inte spara prompts: ' + (res.error || 'Okänt fel')).show();
            $('#prompts-edit-success').hide();
        }
    })
    .catch(err => {
        console.error('Error saving form prompts:', err);
        $('#prompts-edit-error').text('Nätverksfel vid sparning.').show();
        $('#prompts-edit-success').hide();
    });
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