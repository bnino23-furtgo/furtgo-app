const QRCode = require('qrcode');
const path = require('path');

const outDir = path.join(__dirname, '..', 'assets', 'qr-codes');

const ziele = [
  { url: 'https://furtgo.ch', file: 'furtgo-ch.png' },
  { url: 'https://app.furtgo.ch', file: 'app-furtgo-ch.png' },
];

(async () => {
  for (const z of ziele) {
    const ausgabe = path.join(outDir, z.file);
    await QRCode.toFile(ausgabe, z.url, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#16213e', light: '#ffffff' },
    });
    console.log(`OK: ${z.url} -> ${ausgabe}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
