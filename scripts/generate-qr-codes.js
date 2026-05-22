const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'assets', 'qr-codes');

const ziele = [
  {
    url: 'https://furtgo.ch',
    file: 'furtgo-ch',
    label1: 'Fahrgast / Fahrer',
    label2: 'Android',
  },
  {
    url: 'https://app.furtgo.ch',
    file: 'app-furtgo-ch',
    label1: 'iOS Fahrgast / Fahrer',
    label2: '(coming soon)',
  },
];

const FARBE_DUNKEL = '#16213e';
const FARBE_GOLD = '#FFD700';
const FARBE_HELL = '#ffffff';

function baueSvg({ qrInnerSvg, label1, label2 }) {
  // Layout 800 × 1100 — A-Format-ähnlich, Druck-tauglich
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100" width="800" height="1100">
  <rect x="0" y="0" width="800" height="1100" fill="${FARBE_HELL}"/>

  <!-- Furtgo Wortmarke oben -->
  <rect x="0" y="0" width="800" height="120" fill="${FARBE_DUNKEL}"/>
  <text x="400" y="78" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="56" font-weight="800" letter-spacing="4" fill="${FARBE_GOLD}">FURTGO</text>

  <!-- QR-Code zentral -->
  <svg x="100" y="170" width="600" height="600" viewBox="0 0 29 29" preserveAspectRatio="xMidYMid meet">
    ${qrInnerSvg}
  </svg>

  <!-- Trennstrich -->
  <rect x="200" y="820" width="400" height="3" fill="${FARBE_GOLD}"/>

  <!-- Label-Block -->
  <text x="400" y="900" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="42" font-weight="700" fill="${FARBE_DUNKEL}">${escape(label1)}</text>
  <text x="400" y="960" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="42" font-weight="700" fill="${FARBE_DUNKEL}">${escape(label2)}</text>

  <!-- URL klein unten -->
  <text x="400" y="1050" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="22" fill="#666">furtgo.ch</text>
</svg>`;
}

function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

(async () => {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const z of ziele) {
    // PNG-Variante (reine QR ohne Beschriftung, wie bisher)
    await QRCode.toFile(path.join(outDir, `${z.file}.png`), z.url, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: FARBE_DUNKEL, light: FARBE_HELL },
    });

    // SVG mit Beschriftung
    const qrFullSvg = await QRCode.toString(z.url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: FARBE_DUNKEL, light: FARBE_HELL },
    });
    // Inneres extrahieren (zwischen <svg ...> ... </svg>)
    const inner = qrFullSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

    const wrapped = baueSvg({
      qrInnerSvg: inner,
      label1: z.label1,
      label2: z.label2,
    });
    fs.writeFileSync(path.join(outDir, `${z.file}-label.svg`), wrapped, 'utf8');

    console.log(`OK: ${z.url} → ${z.file}.png + ${z.file}-label.svg`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
