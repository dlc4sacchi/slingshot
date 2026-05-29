// MV3 service worker entry (Chrome + Firefox 121+). Loads the same scripts as a single chain.
importScripts('storage.js');
importScripts('telemetry/heartbeat.js');
importScripts('background.js');
