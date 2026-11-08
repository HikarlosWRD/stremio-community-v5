'use strict';

const fs = require('fs');
const path = require('path');

// Give the bundled service a profile and disk cache of its own.
const appPath = path.join(__dirname, 'portable_config', 'streaming-server');
const settingsFile = path.join(appPath, 'server-settings.json');
const MiB = 1024 ** 2;

fs.mkdirSync(appPath, { recursive: true });
try {
    const profile = {
        cacheSize: 10 * 1024 * MiB,
        btMaxConnections: 100,
        btMinPeersForStable: 10,
        btDownloadSpeedSoftLimit: 20 * MiB,
        btDownloadSpeedHardLimit: 64 * MiB,
    };
    fs.writeFileSync(settingsFile, JSON.stringify(profile, null, 2) + '\n', { flag: 'wx' });
} catch (error) {
    if (error.code !== 'EEXIST') throw error;
}

process.env.APP_PATH = appPath;
require('./server.js');
