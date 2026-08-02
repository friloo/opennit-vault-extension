'use strict';

// ── Cache ──────────────────────────────────────────────────────────────────
let cachedEntries = null;
let cacheTime     = 0;
const CACHE_TTL   = 5 * 60 * 1000; // 5 Minuten
const faviconCache = new Map();
let pendingClip = null;
let refreshInFlight = null;   // Single-Flight: verhindert parallele Refresh-Aufrufe (Rotation-Race)

async function getServerUrl() {
    const c = await new Promise(r => chrome.storage.local.get(['serverUrl'], r));
    return c.serverUrl || null;
}

// ── Zugangstoken beschaffen (SSO-Refresh oder manueller Token) ──────────────
// Reihenfolge: manueller Token (Erweitert) > SSO-Access-Token (mit Auto-Refresh).
async function getAccessToken() {
    const cfg = await new Promise(r => chrome.storage.local.get(
        ['serverUrl', 'apiToken', 'apiRefreshToken', 'apiRefreshExpiresAt'], r));
    if (!cfg.serverUrl) return null;
    if (cfg.apiToken) return cfg.apiToken;               // manueller Token
    if (!cfg.apiRefreshToken) return null;               // nicht angemeldet
    const sess = await chrome.storage.session.get(['accessToken', 'accessExpiresAt']);
    if (sess.accessToken && sess.accessExpiresAt && Date.now() < sess.accessExpiresAt - 30000) {
        return sess.accessToken;
    }
    // Nur EINEN Refresh gleichzeitig ausführen; parallele Aufrufer warten mit.
    if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken(cfg).finally(() => { refreshInFlight = null; });
    }
    return await refreshInFlight;
}

async function refreshAccessToken(cfg) {
    try {
        const body = new URLSearchParams();
        body.append('grant_type', 'refresh_token');
        body.append('refresh_token', cfg.apiRefreshToken);
        const res = await fetch(`${cfg.serverUrl}/api/vault/extension/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            // ungültig / abgelaufen / Reuse-Detection → SSO-Tokens verwerfen (Re-Login nötig)
            await chrome.storage.local.remove(['apiRefreshToken', 'apiRefreshExpiresAt']);
            await chrome.storage.session.remove(['accessToken', 'accessExpiresAt']);
            return null;
        }
        const data = await res.json();
        // Rotation: den NEUEN Refresh-Token speichern.
        await chrome.storage.local.set({
            apiRefreshToken: data.refresh_token,
            apiRefreshExpiresAt: Date.now() + (data.refresh_expires_in || 0) * 1000,
        });
        await chrome.storage.session.set({
            accessToken: data.access_token,
            accessExpiresAt: Date.now() + (data.expires_in || 0) * 1000,
        });
        return data.access_token;
    } catch (e) { return null; }
}

// Zentraler API-Aufruf: hängt Server-URL + gültigen Bearer an. null = nicht verfügbar.
async function apiFetch(path, opts = {}) {
    const serverUrl = await getServerUrl();
    const token = await getAccessToken();
    if (!serverUrl || !token) return null;
    const headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + token });
    return fetch(serverUrl + path, Object.assign({}, opts, { headers }));
}

// ── Lock-Gate (serverseitig erzwungen; Client spiegelt nur) ─────────────────
async function lockSettings() {
    return new Promise(resolve => chrome.storage.local.get(['lockDuration', 'lockEnabled'], resolve));
}
function lockRequired(s) { return !!s.lockEnabled; }
function durationSecs(dur) {
    switch (String(dur)) {
        case '5':  return 300;
        case '60': return 3600;
        case 'session': return 43200;
        case 'off': return 900;
        default:   return 900;
    }
}
async function isUnlocked() {
    const s = await lockSettings();
    if (!lockRequired(s)) return true;
    const sess = await chrome.storage.session.get(['unlock']);
    const u = sess.unlock;
    if (!u) return false;
    if (u.sticky) return true;
    return !!u.until && Date.now() < u.until;
}
async function setUnlockedLocal(dur) {
    const unlock = (String(dur) === 'session') ? { sticky: true } : { until: Date.now() + durationSecs(dur) * 1000 };
    await chrome.storage.session.set({ unlock });
}
async function clearUnlocked() {
    await chrome.storage.session.remove('unlock');
    cachedEntries = null; cacheTime = 0; faviconCache.clear();
    try { await apiFetch('/api/vault/extension/lock', { method: 'POST' }); } catch (e) { /* ignore */ }
}
async function onServerLocked() {
    await chrome.storage.session.remove('unlock');
    cachedEntries = null; cacheTime = 0;
}
async function doUnlock(pin) {
    const s = await lockSettings();
    const dur = s.lockDuration || '15';
    try {
        const body = new URLSearchParams();
        body.append('pin', pin);
        body.append('duration_secs', String(durationSecs(dur)));
        const res = await apiFetch('/api/vault/extension/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res) return { ok: false, error: 'Nicht konfiguriert.' };
        const data = await res.json().catch(() => ({}));
        if (data.ok) { await setUnlockedLocal(dur); return { ok: true }; }
        return { ok: false, error: data.error || 'PIN falsch.', lockSecs: data.lock_secs || 0 };
    } catch (e) { return { ok: false, error: 'Verbindungsfehler.' }; }
}

// ── Daten ───────────────────────────────────────────────────────────────────
async function fetchEntries(force = false) {
    if (!(await isUnlocked())) return { entries: null, locked: true };
    const now = Date.now();
    if (!force && cachedEntries && (now - cacheTime) < CACHE_TTL) {
        return { entries: cachedEntries, locked: false };
    }
    try {
        const res = await apiFetch('/api/vault/extension/entries');
        if (!res) return { entries: null, locked: false };
        if (res.status === 423) { await onServerLocked(); return { entries: null, locked: true }; }
        if (!res.ok) { cachedEntries = null; return { entries: null, locked: false }; }
        const data = await res.json();
        if (data.ok) {
            cachedEntries = data.entries; cacheTime = Date.now();
            return { entries: cachedEntries, locked: false };
        }
    } catch (e) { /* ignore */ }
    return { entries: null, locked: false };
}

async function fetchPassword(entryId) {
    if (!(await isUnlocked())) return null;
    try {
        const res = await apiFetch(`/api/vault/extension/entries/${entryId}/password`);
        if (!res) return null;
        if (res.status === 423) { await onServerLocked(); return null; }
        if (!res.ok) return null;
        const data = await res.json();
        return data.ok ? data.password : null;
    } catch (e) { return null; }
}

async function fetchTotp(entryId) {
    if (!(await isUnlocked())) return null;
    try {
        const res = await apiFetch(`/api/vault/extension/entries/${entryId}/totp`);
        if (!res) return null;
        if (res.status === 423) { await onServerLocked(); return null; }
        if (!res.ok) return null;
        const data = await res.json();
        return data.ok ? { code: data.code, remaining: data.remaining } : null;
    } catch (e) { return null; }
}

async function fetchFavicon(entryId) {
    if (faviconCache.has(entryId)) return faviconCache.get(entryId);
    try {
        const res = await apiFetch(`/api/vault/extension/entries/${entryId}/favicon?fetch=1`);
        if (!res || !res.ok) { faviconCache.set(entryId, null); return null; }
        const blob = await res.blob();
        const dataUrl = await new Promise(resolve => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
        });
        faviconCache.set(entryId, dataUrl);
        return dataUrl;
    } catch (e) { return null; }
}

function matchUrl(entryUrl, pageUrl) {
    if (!entryUrl) return false;
    let pHost;
    try { pHost = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return false; }
    return String(entryUrl).split('\n').some(line => {
        const raw = line.trim();
        if (!raw) return false;
        try {
            const eu = raw.includes('://') ? raw : 'https://' + raw;
            let eHost = new URL(eu).hostname.replace(/^www\./, '');
            if (eHost.startsWith('*.')) eHost = eHost.slice(2);
            return pHost === eHost || pHost.endsWith('.' + eHost);
        } catch { return false; }
    });
}

// ── Zwischenablage automatisch leeren (Offscreen) ───────────────────────────
async function scheduleClipClear(text) {
    const cfg = await new Promise(r => chrome.storage.local.get(['clipClear'], r));
    if (cfg.clipClear === false) return;
    pendingClip = text || '';
    chrome.alarms.create('clipClear', { delayInMinutes: 0.5 });
}
async function clearClipboard() {
    try {
        if (!chrome.offscreen) return;
        const has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
        if (!has) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html', reasons: ['CLIPBOARD'],
                justification: 'Zwischenablage nach dem Kopieren von Zugangsdaten leeren.',
            });
        }
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CLIP_WRITE', text: '' });
    } catch (e) { /* ignore */ }
}

// ── Status prüfen (Bearer) ──────────────────────────────────────────────────
async function checkStatus() {
    const res = await apiFetch('/api/vault/extension/status');
    if (!res) return { ok: false, reason: 'not_configured' };
    try {
        const data = await res.json();
        if (data && typeof data.pin_enabled !== 'undefined') {
            await new Promise(r => chrome.storage.local.set({ lockEnabled: !!data.pin_enabled }, r));
        }
        return data;
    } catch { return { ok: false, reason: 'network_error' }; }
}

// ── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target === 'offscreen') return;
    if (msg.type === 'GET_ENTRIES') {
        fetchEntries(msg.force).then(r => sendResponse({ entries: r.entries, locked: r.locked }));
        return true;
    }
    if (msg.type === 'GET_MATCHING_ENTRIES') {
        fetchEntries().then(r => {
            const matched = (r.entries || []).filter(e => matchUrl(e.url, msg.url));
            sendResponse({ entries: matched, locked: r.locked });
        });
        return true;
    }
    if (msg.type === 'GET_PASSWORD') { fetchPassword(msg.id).then(password => sendResponse({ password })); return true; }
    if (msg.type === 'GET_TOTP') { fetchTotp(msg.id).then(result => sendResponse(result)); return true; }
    if (msg.type === 'GET_FAVICON') { fetchFavicon(msg.id).then(dataUrl => sendResponse({ dataUrl })); return true; }
    if (msg.type === 'GET_LOCK') {
        Promise.all([lockSettings(), isUnlocked()]).then(([s, unlocked]) => sendResponse({ required: lockRequired(s), unlocked }));
        return true;
    }
    if (msg.type === 'DO_UNLOCK') { doUnlock(msg.pin || '').then(sendResponse); return true; }
    if (msg.type === 'LOCK_NOW') { clearUnlocked().then(() => sendResponse({ ok: true })); return true; }
    if (msg.type === 'SCHEDULE_CLIP_CLEAR') { scheduleClipClear(msg.text || ''); sendResponse({ ok: true }); return true; }
    if (msg.type === 'CHECK_STATUS') { checkStatus().then(sendResponse); return true; }
    if (msg.type === 'CLEAR_CACHE') { cachedEntries = null; cacheTime = 0; faviconCache.clear(); sendResponse({ ok: true }); return true; }
});

// Cache alle 5 Minuten leeren; Zwischenablage-Clear nach Timeout.
chrome.alarms.create('clearCache', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'clearCache') { cachedEntries = null; cacheTime = 0; faviconCache.clear(); return; }
    if (alarm.name === 'clipClear') { await clearClipboard(); pendingClip = null; }
});