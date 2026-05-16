// Liest app.json und überschreibt googleServicesFile mit der EAS file env var,
// damit die im Repo per .gitignore ausgeschlossene Datei beim Cloud-Build verfügbar ist.
const appJson = require('./app.json');

module.exports = () => {
  const expo = { ...appJson.expo };
  const googleServicesPath = process.env.GOOGLE_SERVICES_JSON;
  if (googleServicesPath) {
    expo.android = { ...expo.android, googleServicesFile: googleServicesPath };
  }
  return expo;
};
