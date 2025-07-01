// Säkerställ global boatData-objekt (kan finnas som const från gammal cache)
if (!window.boatData || typeof window.boatData !== 'object') {
    window.boatData = {};
}
const getBoatData = () => window.boatData;

// API-bas beroende på miljö
const DATA_BASE = location.hostname === 'localhost' ? 'http://localhost:8001' : 'https://henricssons-api.onrender.com';

// Initialize when document is ready
$(document).ready(function() {
    const ts = Date.now();
    // Safari returnerar ibland 304 Not Modified trots cache-busting query-string.
    // För att säkerställa att vi alltid får en kropp (status 200) ber vi uttryckligen
    // om en "no-store"-hämtning. Om vi ändå får 304 faller vi tillbaka till eventuell
    // redan befintlig boatData.
    fetch(`${DATA_BASE}/boat_data.json?v=${ts}`, { cache: 'no-store' })
        .then(r => {
            if (r.ok) {
                return r.json();
            }
            if (r.status === 304) {
                // 304 innebär "oförändrad" – använd befintliga data om de finns.
                if (window.boatData && Object.keys(window.boatData).length) {
                    return window.boatData;
                }
                // Första laddningen utan data – försök igen utan villkorad cache.
                return fetch(`${DATA_BASE}/boat_data.json?nocache=${ts + 1}`, { cache: 'reload' }).then(res => res.ok ? res.json() : null);
            }
            return null;
        })
        .then(json => {
            if(json && typeof json === 'object') {
                if (window.boatData && typeof window.boatData === 'object') {
                    Object.assign(window.boatData, json);
                } else {
                    window.boatData = json;
                }
                console.log('Loaded boat_data.json', Object.keys(window.boatData).length, 'manufacturers');
            } else {
                alert('Kunde inte läsa boat_data.json');
            }
        })
        .catch(err => {
            console.error('Fel vid hämtning av boat_data.json', err);
            alert('Fel: kunde inte hämta båtdata');
        })
        .finally(() => {
            initializeGrids();
            setupEventListeners();
            preselectFromStorage();
            
            // Starta automatisk uppdatering av boat_data.json var 30:e sekund
            // så att admin-ändringar visas automatiskt
            setInterval(refreshBoatData, 30000);
        });
    
    // Confirmation message for Formspree
    const form = document.querySelector('form[action="https://formspree.io/f/xnnvovbk"]');
    if (form) {
        form.addEventListener('submit', function(e) {
            // Let the form submit normally
            setTimeout(function() {
                form.style.display = 'none';
                const msg = document.createElement('div');
                msg.className = 'form-success-message';
                msg.innerHTML = '<h3 style="color:#b89300; text-align:center; margin:2rem 0;">Tack för din förfrågan!<br>Vi återkommer till dig så snart vi kan.</h3>';
                form.parentNode.appendChild(msg);
            }, 100); // Wait a bit to allow Formspree to process
        });
    }
});

function initializeGrids() {
    const boatData = getBoatData();

    if (!boatData || Object.keys(boatData).length === 0) {
        console.error('boatData is tomt');
        return;
    }

    // Filtrera bort poster utan giltigt namn eller modellista
    const validKeys = Object.keys(boatData).filter(k => {
        const m = boatData[k];
        return m && typeof m.name === 'string' && m.name.trim() !== '' && Array.isArray(m.models);
    });

    console.log('boatData giltiga poster:', validKeys.length, 'av', Object.keys(boatData).length);

    const grid1 = $('.grid1');
    const manuKeys = validKeys.sort((a,b)=> {
        const nameA = boatData[a].name.toLowerCase();
        const nameB = boatData[b].name.toLowerCase();
        return nameA.localeCompare(nameB,'sv',{sensitivity:'base'});
    });

    manuKeys.forEach(key => {
        const manufacturer = boatData[key];
        const item = $(`<div class="grid1-item" data-filter=".${key}">${manufacturer.name}</div>`);
        grid1.append(item);
    });

    console.log('Manufacturers populated:', grid1.children().length, 'items');

    // Populate model grid
    const grid2 = $('.grid2');
    manuKeys.forEach(key => {
        const manufacturer = boatData[key];
        const sortedModels = (manufacturer.models||[]).slice().sort((a,b)=>{
            const nameA = typeof a === 'string' ? a : a.name;
            const nameB = typeof b === 'string' ? b : b.name;
            return nameA.localeCompare(nameB,'sv',{sensitivity:'base'});
        });
        sortedModels.forEach(model => {
            const modelName = typeof model === 'string' ? model : model.name;
            const item = $(`<div class="grid2-item ${key}">${modelName}</div>`);
            grid2.append(item);
        });
    });

    console.log('Models populated:', grid2.children().length, 'items');

    // Initialize isotope for grid1
    $grid1 = $('.grid1').isotope({
        itemSelector: '.grid1-item',
        layoutMode: 'fitRows',
        filter: '*',
    });

    // Initialize isotope for grid2
    $grid2 = $('.grid2').isotope({
        itemSelector: '.grid2-item',
        layoutMode: 'fitRows',
        filter: '-',
    });
}

function setupEventListeners() {
    // Quick search functionality
    var qsRegex;
    var $quicksearch = $('.quicksearch').keyup(debounce(function() {
        qsRegex = new RegExp($quicksearch.val(), 'gi');

        if ($quicksearch.val() == "") {
            $grid1.isotope({ filter: '*' });
            $grid2.isotope({ filter: '-' });
            $('.grid1-item').removeClass("selected-t");
            $('.grid2-item').removeClass("selected-m");
            $("#modell-container").addClass("inaktiv");
            document.getElementById("T-field").value = "";
            document.getElementById("M-field").value = "";
        } else {
            $grid1.isotope({
                filter: function() {
                    return qsRegex ? $(this).text().match(qsRegex) : true;
                }
            });
        }
    }, 200));

    // Clear search button
    $('#clear-qs').on('click', function() {
        document.getElementById("tillverkare").value = "";
        $grid1.isotope({ filter: '*' });
        $grid2.isotope({ filter: '-' });
        $('.grid1-item').removeClass("selected-t");
        $('.grid2-item').removeClass("selected-m");
        $("#modell-container").addClass("inaktiv");
        document.getElementById("T-field").value = "";
        document.getElementById("M-field").value = "";
        $('#rensa-grid1').css('display', 'none');
        $('#rensa-grid2').css('display', 'none');
    });

    // Filter buttons (Visa alla / Dölj alla)
    $('.filters1').on('click', 'a', function() {
        var filterValue = $(this).attr('data-filter');
        $grid1.isotope({ filter: filterValue });
        $grid2.isotope({ filter: '-' });

        $('.grid1-item').removeClass("selected-t");
        $('.grid2-item').removeClass("selected-m");
        $("#modell-container").addClass("inaktiv");
        document.getElementById("T-field").value = "";
        document.getElementById("M-field").value = "";
        $('#rensa-grid1').css('display', 'none');
    });

    // Clear selection button for manufacturers
    $('#rensa-grid1').on('click', function() {
        $('.grid1-item').removeClass("selected-t");
        $('.grid2-item').removeClass("selected-m");
        $("#modell-container").addClass("inaktiv");
        $grid2.isotope({ filter: '-' });
        document.getElementById("T-field").value = "";
        document.getElementById("M-field").value = "";
        $('#rensa-grid1').css('display', 'none');
        $('#rensa-grid2').css('display', 'none');
    });

    // Manufacturer selection
    $('.grid1-item').on('click', function() {
        var filterValue = $(this).attr('data-filter');
        $grid2.isotope({ filter: filterValue });

        $('.grid1-item').removeClass("selected-t");
        $('.grid2-item').removeClass("selected-m");
        $(this).addClass("selected-t");
        $('#rensa-grid1').css('display', 'inline-block');
        $("#modell-container").removeClass("inaktiv");

        document.getElementById("M-field").value = "";
        document.getElementById("T-field").value = this.innerText;

        // Scroll to model container
        $('html, body').animate({
            scrollTop: $("#modell-container").offset().top - 145
        }, 800);
    });

    // Model selection
    $('.grid2-item').on('click', function() {
        $('.grid2-item').removeClass("selected-m");
        $(this).addClass("selected-m");
        $('#rensa-grid2').css('display', 'inline-block');

        document.getElementById("M-field").value = this.innerText;

        // Scroll to contact form
        $('html, body').animate({
            scrollTop: $("#contact-form").offset().top - 145
        }, 800);
    });

    // Clear selection button for models
    $('#rensa-grid2').on('click', function() {
        $('.grid2-item').removeClass("selected-m");
        $('#rensa-grid2').css('display', 'none');
        document.getElementById("M-field").value = "";
    });

    // Prevent form submission on search
    $('#qs-form').submit(function() {
        return false;
    });
}

// Debounce function
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

// Förvald tillverkare och modell, lagras av bilder-exempel-sidan
function preselectFromStorage(){
    const manuName=localStorage.getItem('preselectManufacturer');
    const modelName=localStorage.getItem('preselectModel');
    if(!manuName||!modelName) return;

    // Hitta grid1-elementet med samma text (case-insensitivt)
    const $manuEl=$('.grid1-item').filter(function(){
        return $(this).text().trim().toLowerCase()===manuName.trim().toLowerCase();
    }).first();

    if($manuEl.length){
        // Klicka tillverkare för att filtrera modeller
        $manuEl.trigger('click');

        // Vänta kort så isotope hinner filtrera
        setTimeout(()=>{
            const $modelEl=$('.grid2-item').filter(function(){
                return $(this).text().trim().toLowerCase()===modelName.trim().toLowerCase();
            }).first();
            if($modelEl.length){
                $modelEl.trigger('click');
            }
        },100);
    }

    // Nollställ sparade värden
    localStorage.removeItem('preselectManufacturer');
    localStorage.removeItem('preselectModel');
}

// Funktion för att uppdatera boat_data.json automatiskt
function refreshBoatData() {
    const ts = Date.now();
    fetch(`${DATA_BASE}/boat_data.json?v=${ts}`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(json => {
            if (json && typeof json === 'object') {
                // Jämför med befintlig data för att se om något ändrats
                const currentKeys = Object.keys(window.boatData || {});
                const newKeys = Object.keys(json);
                
                // Om antal tillverkare ändrats eller nya tillverkare tillagts
                if (currentKeys.length !== newKeys.length || 
                    !currentKeys.every(key => newKeys.includes(key))) {
                    
                    console.log('Boat data uppdaterad - laddar om grid');
                    window.boatData = json;
                    initializeGrids();
                }
            }
        })
        .catch(err => {
            console.log('Kunde inte uppdatera boat_data.json:', err);
        });
} 