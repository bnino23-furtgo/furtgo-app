const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Windows-Kompatibilität: kein Multiprocessing
config.maxWorkers = 1;

module.exports = config;
