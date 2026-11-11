# Alimentos Sanos

(Repositorio y URL: `mi-despensa`. La base de datos local se sigue llamando `mi-despensa` para conservar los datos.)

PWA personal (en español) para complementar a Yuka: escanea el código de barras, consulta Open Food Facts / Open Beauty Facts y guarda el producto en **tus propias categorías** (Embutidos, Yogures, Cosmética…) con tu valoración (1-5 ★ y Bueno/Regular/Evitar) y notas.

- Sin servidor ni build: HTML + CSS + JS estático. Datos en IndexedDB del navegador; copia de seguridad en JSON desde Ajustes.
- Escáner: [html5-qrcode](https://github.com/mebjas/html5-qrcode) 2.3.8 (Apache-2.0), usa BarcodeDetector nativo cuando existe. Requiere HTTPS.
- Auto-actualización: service worker con caché versionada, red primero para la app, `skipWaiting` + `clients.claim`, y comprobación de `version.json` al abrir, al volver a la app y cada 30 min.

## Publicar una versión nueva
1. Cambia el código.
2. `./release.sh 1.0.1` (sube la versión en `app.js`, `sw.js` y `version.json`).
3. Sube los archivos (GitHub Pages: commit + push a `main`).
Los móviles con la app instalada se actualizan solos; los datos guardados no se tocan.
