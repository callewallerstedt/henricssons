document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu functionality
    const menuBtn = document.querySelector('.menu-btn');
    const navMenu = document.querySelector('.nav-menu');
    
    if (menuBtn && navMenu) {
        menuBtn.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            menuBtn.classList.toggle('active');
        });
    }

    // Close mobile menu when clicking outside
    document.addEventListener('click', function(event) {
        if (navMenu && navMenu.classList.contains('active')) {
            if (!event.target.closest('.nav-menu') && !event.target.closest('.menu-btn')) {
                navMenu.classList.remove('active');
                menuBtn.classList.remove('active');
            }
        }
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                // Close mobile menu after clicking a link
                if (navMenu && navMenu.classList.contains('active')) {
                    navMenu.classList.remove('active');
                    menuBtn.classList.remove('active');
                }
            }
        });
    });

    // Add shadow to header on scroll
    const header = document.querySelector('.header');
    if (header) {
        window.addEventListener('scroll', function() {
            if (window.scrollY > 0) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        });
    }

    // Gallery filtering
    const filterButtons = document.querySelectorAll('.filter-btn');
    const galleryItems = document.querySelectorAll('.gallery-item');

    if (filterButtons.length > 0 && galleryItems.length > 0) {
        filterButtons.forEach(button => {
            button.addEventListener('click', function() {
                // Remove active class from all buttons
                filterButtons.forEach(btn => btn.classList.remove('active'));
                // Add active class to clicked button
                this.classList.add('active');

                const filterValue = this.getAttribute('data-filter');

                galleryItems.forEach(item => {
                    if (filterValue === 'all' || item.getAttribute('data-category') === filterValue) {
                        item.style.display = 'block';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });
    }

    // Manufacturer search functionality
    const manufacturerSelect = document.getElementById('manufacturer');
    const boatModelSelect = document.getElementById('boatModel');

    if (manufacturerSelect) {
        // Complete list of manufacturers
        const manufacturers = [
            'AMT', 'Adec', 'Advance', 'Agder', 'Alamarin', 'Albin', 'Alicraft', 'Alo', 'Alufish', 'Amigo',
            'Ancas Queen', 'Andy', 'Apashe', 'Aquador', 'Arendal', 'Arimar', 'Aro', 'Arriwa', 'Arvor', 'Askeladden',
            'Atlantic', 'Avanti', 'BM', 'BMB', 'Barracuda', 'Bavaria', 'Bayliner', 'Bella', 'Bellmar', 'Bergslagsbåtar',
            'Bever', 'Biam', 'BigBuster', 'Bowie', 'Buster', 'Camo', 'Candy', 'Carat', 'Caravelle', 'Castello',
            'Celest', 'Chaparal', 'Chaparall', 'Chrystal', 'Cinera', 'Clipper', 'Cobalt', 'Cobra', 'Colin', 'Comet',
            'Comfort', 'Corvin', 'Crescent', 'Dacapo', 'Day', 'Degera', 'Dehler', 'Delta', 'Diana', 'Draco',
            'Drago', 'Dragonfly', 'Drive', 'EA', 'Egda', 'Elan', 'Elwaro', 'Enes', 'Enoski', 'Eurofisher',
            'Fairline', 'Faster', 'Fevik', 'FinnArk', 'FinnFamily', 'FinnMaster', 'FinnSpeed', 'FinnTern', 'Fjord', 'Fjordling',
            'Flipper', 'Folcparca', 'Folkparca', 'Formel', 'Four', 'FourWinns', 'Fram', 'GH', 'Galeon', 'Gimle',
            'Glastrone', 'Gozzi', 'Grandezza', 'Gullholmensnipa', 'Gullhomensnipa', 'H', 'H.B', 'H.B.21', 'HR', 'Halco',
            'Hallberg-Rassy', 'Halwa', 'Hamariina', 'Hanko', 'Hanse', 'Hansen Protection A/S', 'Hansvik', 'Hanto', 'Hasla', 'Henåjulle',
            'Hero', 'Herwa', 'Hirvas', 'Hui', 'Hurricane', 'Huwa', 'Hydrolift', 'Hydromarin', 'IF', 'Imma',
            'Infra', 'Inlander', 'Inter', 'J-marin', 'Jans-Entry', 'Jarnmarin', 'Jeanneau', 'Jenco', 'Jernbanebåt', 'Joda',
            'Jofa', 'Jogg', 'Jokkeri', 'Jurmo', 'K.B', 'KB', 'Kaisla', 'Karnic', 'Kato', 'Killing',
            'Kmv', 'Kragero', 'Ks', 'LM', 'Laguna', 'Lami', 'Leto', 'Lido', 'Linder', 'Lohi',
            'Luna', 'MV-Marin', 'Mamba', 'Marex', 'Marino', 'Master', 'Maxi', 'Maxim', 'Maxum', 'Micore',
            'Mini', 'Monark', 'Monker', 'Monterey', 'Move', 'NBmarine', 'Naps', 'Nautico', 'Nb', 'Nefiti',
            'Nidelv', 'Nidelv/Nilsen', 'Nilsen', 'Nimbus', 'Nimo', 'Nor', 'Nor-Dan', 'NorStar', 'Nora', 'NordSea',
            'Nordan', 'Nordfun', 'Nordkapp', 'OE', 'Ockelbo', 'Ohlson', 'Omre', 'Orrskär 27', 'Otto', 'Ovre',
            'Piancraft', 'Pioner', 'Polar', 'Porch', 'Quicksilver', 'Raisport', 'Ramin', 'Rana', 'Rator', 'Risor',
            'Riviera', 'Rock', 'Roland', 'Roma', 'Runno', 'Ryds', 'Rånas', 'Safir', 'Saga', 'Sandvik',
            'Scand', 'Scandinaval', 'Scanmar', 'Scantic', 'Scotty', 'Scout', 'SeaRay', 'SeaSprite', 'SeaStar', 'Seabird',
            'Seabreaker', 'Seaco', 'Seaking', 'Seiskari', 'Selco', 'Shipman', 'Silje', 'Silver', 'Sjömann', 'Skagerak',
            'Skarpnes', 'Skibsplast', 'Skilsö', 'Smiling', 'Snekling', 'Sofa', 'Sollux', 'Soumi', 'Springer', 'StarBoat',
            'StarGraft', 'Still', 'Stingray', 'Stormway', 'Storsjö', 'Style', 'Summer', 'SunCamp', 'SunFisher', 'SunOdyssey',
            'Sunbird', 'Sunbrella+', 'Sunwind', 'Suvi', 'Sölvjoh', 'Sölvspeed', 'Taule', 'Timola', 'Tracker', 'Tresfjord',
            'Tristan', 'Troll', 'Tromsöy', 'TuusSport', 'TuusVene', 'Tönsbergjolle', 'Unique', 'Uttern', 'Vator', 'VerkkoSArki',
            'Vesling', 'Vestfjord', 'Veto', 'Viking', 'Viknes', 'Viksund', 'Virbosnipa', 'Vista', 'Weekend', 'Wellcraft',
            'Wesling', 'Wester', 'Westkapp', 'Wiking', 'Willing', 'Willys', 'Windjammer', 'Windy', 'Winga', 'Winrace',
            'X', 'XO', 'Yamarin', 'Örnvik'
        ].sort(); // Sort alphabetically

        // Clear existing options except the default one
        while (manufacturerSelect.options.length > 1) {
            manufacturerSelect.remove(1);
        }

        // Populate manufacturer select
        manufacturers.forEach(manufacturer => {
            const option = document.createElement('option');
            option.value = manufacturer.toLowerCase().replace(/[^a-z0-9]/g, '-');
            option.textContent = manufacturer;
            manufacturerSelect.appendChild(option);
        });

        // Manufacturer change handler
        manufacturerSelect.addEventListener('change', (e) => {
            const selectedManufacturer = e.target.value;
            if (selectedManufacturer && boatModelSelect) {
                // Clear and populate boat models based on selected manufacturer
                boatModelSelect.innerHTML = '<option value="">Ingen modellbeteckning vald</option>';
                // Add sample models (replace with actual data)
                const models = getBoatModels(selectedManufacturer);
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name;
                    boatModelSelect.appendChild(option);
                });
            } else if (boatModelSelect) {
                boatModelSelect.innerHTML = '<option value="">Ingen modellbeteckning vald</option>';
            }
        });
    }
});

// Sample function to get boat models (replace with actual data)
function getBoatModels(manufacturerId) {
    const modelData = {
        'hallberg-rassy': [
            { id: 'hallberg-rassy-412', name: 'Hallberg-Rassy 412' },
            { id: 'hallberg-rassy-372', name: 'Hallberg-Rassy 372' }
        ],
        'hanse': [
            { id: 'hanse-458', name: 'Hanse 458' },
            { id: 'hanse-388', name: 'Hanse 388' }
        ],
        'jeanneau': [
            { id: 'sun-odyssey-45', name: 'Sun Odyssey 45' },
            { id: 'sun-odyssey-35', name: 'Sun Odyssey 35' }
        ]
    };
    return modelData[manufacturerId] || [];
} 