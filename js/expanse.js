// Solo fetch y traspaso del catálogo a main.js
fetch('../assets/data/music_catalog_expanse.json')
    .then(res => res.json())
    .then(data => {
        window.setCatalog(data);
    });