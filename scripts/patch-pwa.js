// Post-build script: injects PWA + iOS meta tags into dist/index.html,
// creates 404.html for SPA-Routing on GitHub Pages, and writes CNAME.
// Run via: npm run build:web

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const INDEX = path.join(DIST, 'index.html');
const NOT_FOUND = path.join(DIST, '404.html');
const CNAME = path.join(DIST, 'CNAME');

const CUSTOM_DOMAIN = 'app.furtgo.ch';

const META_TAGS = `
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Furtgo">
    <meta name="theme-color" content="#1a1a2e">
`;

if (!fs.existsSync(INDEX)) {
  console.error('[patch-pwa] dist/index.html nicht gefunden. Zuerst `expo export -p web` laufen lassen.');
  process.exit(1);
}

let html = fs.readFileSync(INDEX, 'utf8');

// Viewport aktualisieren (fuer iOS safe-area)
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">'
);

// PWA/iOS Meta-Tags vor </head> einfuegen, falls noch nicht vorhanden
if (!html.includes('rel="manifest"')) {
  html = html.replace('</head>', `${META_TAGS}  </head>`);
}

fs.writeFileSync(INDEX, html, 'utf8');
console.log('[patch-pwa] index.html gepatcht');

// 404.html als Kopie von index.html (GitHub Pages SPA-Routing Trick)
fs.writeFileSync(NOT_FOUND, html, 'utf8');
console.log('[patch-pwa] 404.html geschrieben');

// CNAME fuer Custom Domain
fs.writeFileSync(CNAME, CUSTOM_DOMAIN + '\n', 'utf8');
console.log(`[patch-pwa] CNAME geschrieben: ${CUSTOM_DOMAIN}`);

// .nojekyll damit GitHub Pages keine Jekyll-Verarbeitung macht (Expo-Dateien mit _ werden sonst ignoriert)
fs.writeFileSync(path.join(DIST, '.nojekyll'), '', 'utf8');
console.log('[patch-pwa] .nojekyll geschrieben');

console.log('[patch-pwa] fertig.');
