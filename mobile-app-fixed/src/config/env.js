// src/config/env.js
//
// Single place to control which backend the app talks to.
//
// OLD (AWS EC2):        'http://54.144.58.195'
// CURRENT (local test):  'http://localhost:3000'   — browser on this same PC
// Android emulator:      'http://10.0.2.2:3000'    — emulator's alias for "this PC"
// Real phone, same WiFi: 'http://<this-PC-LAN-IP>:3000'
// Real phone, anywhere (after home hosting is live):
//   export const API_BASE_URL = 'https://freshmart-api.trycloudflare.com';
//   or  'https://freshmart.duckdns.org'

export const API_BASE_URL = 'http://103.211.203.145:3000';