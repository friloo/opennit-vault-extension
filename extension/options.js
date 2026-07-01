'use strict';

function $(id) { return document.getElementById(id); }

// Gespeicherte Werte laden (überschreibt das vorausgefüllte Feld nur wenn bereits gespeichert)
chrome.storage.local.get(['serverUrl', 'apiToken'], cfg => {
    if (cfg.serverUrl) $('serverUrl').value = cfg.serverUrl;
    if (cfg.apiToken)  $('apiToken').value  = '••••••••';
});

// Sicherheits-Einstellungen laden
chrome.storage.local.get(['lockDuration', 'clipClear'], cfg => {
    $('lockDuration').value = (cfg.lockDuration && cfg.lockDuration !== 'off') ? cfg.lockDuration : '15';
    $('clipClear').checked  = cfg.clipClear !== false; // Standard: an
});

$('btnSaveSec').addEventListener('click', () => {
    chrome.storage.local.set({
        lockDuration: $('lockDuration').value,
        clipClear:    $('clipClear').checked,
    }, () => {
        chrome.runtime.sendMessage({ type: 'LOCK_NOW' });
        $('savedSecMsg').innerHTML = '<span class="save-ok">&#10003; Gespeichert</span>';
        setTimeout(() => { $('savedSecMsg').textContent = ''; }, 2000);
    });
});

// App-Name und Verbindungsstatus laden (falls Token bereits gesetzt)
chrome.storage.local.get(['serverUrl', 'apiToken'], async cfg => {
    if (!cfg.serverUrl || !cfg.apiToken) return;
    try {
        const res  = await fetch(`${cfg.serverUrl}/api/vault/extension/status`, {
            headers: { 'Authorization': `Bearer ${cfg.apiToken}` }
        });
        const data = await res.json();
        if (data.ok) {
            // Name der Erweiterung bleibt fest „OpenNIT Vault"; die Instanz wird
            // beim angemeldeten Nutzer zur Orientierung angezeigt.
            if (data.user) {
                $('headerUser').textContent = data.app_name ? (data.user + ' · ' + data.app_name) : data.user;
                $('headerStatus').style.display = '';
            }
        }
    } catch { /* ignore */ }
});

// HTTPS erzwingen (außer localhost) – sonst gingen Token und Passwörter im
// Klartext über die Leitung.
function isSecureServerUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol === 'https:') return true;
        if (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return true;
        return false;
    } catch { return false; }
}

$('btnSave').addEventListener('click', () => {
    const url   = $('serverUrl').value.trim().replace(/\/$/, '');
    const token = $('apiToken').value.trim();
    if (!url) { showStatus('Server-URL darf nicht leer sein.', false); return; }
    if (!isSecureServerUrl(url)) {
        showStatus('Bitte eine <strong>https://</strong>-Adresse verwenden (nur localhost darf http:// sein). Sonst würden Token und Passwörter unverschlüsselt übertragen.', false);
        return;
    }

    const data = { serverUrl: url };
    if (token && !token.startsWith('•')) data.apiToken = token;

    chrome.storage.local.set(data, () => {
        chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
        $('savedMsg').innerHTML = '<span class="save-ok">&#10003; Gespeichert</span>';
        setTimeout(() => { $('savedMsg').textContent = ''; }, 2000);
    });
});

$('btnTest').addEventListener('click', async () => {
    const url   = $('serverUrl').value.trim().replace(/\/$/, '');
    const token = $('apiToken').value.trim();

    if (!url || !token || token.startsWith('•')) {
        showStatus('Bitte zuerst URL und Token eingeben und speichern.', false);
        return;
    }

    $('btnTest').innerHTML = '<span class="fa-spin-sm"></span> Teste&#8230;';
    $('btnTest').disabled = true;

    try {
        const res  = await fetch(`${url}/api/vault/extension/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.ok) {
            showStatus(`Verbunden als <strong>${esc(data.user)}</strong>`, true);
            if (data.user) {
                $('headerUser').textContent = data.user;
                $('headerStatus').style.display = '';
            }
        } else {
            showStatus('Ungültiger Token oder Server-Fehler.', false);
        }
    } catch (e) {
        showStatus('Server nicht erreichbar: ' + esc(e.message), false);
    }

    $('btnTest').innerHTML = 'Verbindung testen';
    $('btnTest').disabled = false;
});

// ── SSO-Anmeldung (OAuth 2.0 + PKCE via chrome.identity) ────────────────────
function b64url(bytes) {
    let s = btoa(String.fromCharCode.apply(null, new Uint8Array(bytes)));
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randB64(len) { const a = new Uint8Array(len); crypto.getRandomValues(a); return b64url(a); }
async function pkceChallenge(verifier) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(d);
}
function ssoMsg(msg, ok) {
    const el = $('ssoMsg');
    if (ok === null) { el.innerHTML = msg ? ('<span style="color:#6c757d;font-size:.82rem;">' + esc(msg) + '</span>') : ''; return; }
    el.innerHTML = ok ? ('<span class="save-ok">&#10003; ' + esc(msg) + '</span>')
                      : ('<span style="color:#dc3545;font-size:.82rem;">' + esc(msg) + '</span>');
    if (ok) setTimeout(() => { el.innerHTML = ''; }, 3000);
}
function ssoSet(area, obj) { return new Promise(r => chrome.storage[area].set(obj, r)); }
function ssoRemove(area, keys) { return new Promise(r => chrome.storage[area].remove(keys, r)); }

async function loginWithSso() {
    const url = $('serverUrl').value.trim().replace(/\/$/, '');
    if (!url) { ssoMsg('Bitte zuerst die Server-URL eingeben.', false); return; }
    if (!isSecureServerUrl(url)) { ssoMsg('Bitte eine https://-Adresse verwenden.', false); return; }
    if (!chrome.identity || !chrome.identity.launchWebAuthFlow) { ssoMsg('Anmeldung wird von diesem Browser nicht unterstützt.', false); return; }

    const verifier    = randB64(48);
    const challenge   = await pkceChallenge(verifier);
    const state       = randB64(16);
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = url + '/vault/extension/authorize?' + new URLSearchParams({
        client_id: 'opennit-vault-extension', redirect_uri: redirectUri, response_type: 'code',
        code_challenge: challenge, code_challenge_method: 'S256', state: state, scope: 'vault',
    }).toString();

    $('btnSso').disabled = true;
    ssoMsg('Anmeldung läuft…', null);
    console.log('[OpenNIT Vault] Auth-URL:', authUrl, '| redirect_uri:', redirectUri);
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirect) => {
        $('btnSso').disabled = false;
        const le = chrome.runtime.lastError ? (chrome.runtime.lastError.message || 'unbekannt') : null;
        console.log('[OpenNIT Vault] launchWebAuthFlow zurück:', { lastError: le, redirect: redirect || null });
        if (le || !redirect) {
            ssoMsg('Anmeldung abgebrochen' + (le ? ' – ' + le : ' (keine Rückmeldung)') + '.', false);
            return;
        }
        let params;
        try { params = new URL(redirect).searchParams; } catch { ssoMsg('Ungültige Antwort.', false); return; }
        if (params.get('error')) { ssoMsg('Abgelehnt (' + params.get('error') + ').', false); return; }
        if (params.get('state') !== state) { ssoMsg('Sicherheitsprüfung fehlgeschlagen (state).', false); return; }
        const code = params.get('code');
        if (!code) { ssoMsg('Kein Autorisierungscode erhalten.', false); return; }
        try {
            const body = new URLSearchParams({ grant_type: 'authorization_code', code: code, code_verifier: verifier, redirect_uri: redirectUri });
            const res = await fetch(url + '/api/vault/extension/oauth/token', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.access_token) { ssoMsg('Token konnte nicht ausgestellt werden.', false); return; }
            await ssoSet('local', { serverUrl: url, apiRefreshToken: data.refresh_token, apiRefreshExpiresAt: Date.now() + (data.refresh_expires_in || 0) * 1000 });
            await ssoRemove('local', ['apiToken']);
            await ssoSet('session', { accessToken: data.access_token, accessExpiresAt: Date.now() + (data.expires_in || 0) * 1000 });
            chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
            ssoMsg('Angemeldet.', true);
            reflectAuthState();
            loadConnStatus();
        } catch (e) { ssoMsg('Verbindungsfehler: ' + e.message, false); }
    });
}

async function logoutSso() {
    const url = $('serverUrl').value.trim().replace(/\/$/, '');
    const cfg = await new Promise(r => chrome.storage.local.get(['apiRefreshToken'], r));
    if (url && cfg.apiRefreshToken) {
        try {
            const b = new URLSearchParams({ token: cfg.apiRefreshToken });
            await fetch(url + '/api/vault/extension/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
        } catch (e) { /* ignore */ }
    }
    await ssoRemove('local', ['apiRefreshToken', 'apiRefreshExpiresAt']);
    await ssoRemove('session', ['accessToken', 'accessExpiresAt', 'unlock']);
    chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    reflectAuthState();
    ssoMsg('Abgemeldet.', true);
    $('headerStatus').style.display = 'none';
}

function reflectAuthState() {
    chrome.storage.local.get(['apiRefreshToken'], cfg => {
        const sso = !!cfg.apiRefreshToken;
        $('btnLogout').style.display = sso ? '' : 'none';
        $('btnSso').lastChild.textContent = sso ? ' Neu anmelden' : ' Mit OpenNIT anmelden';
    });
}

// Verbindungsstatus über den Background (nutzt SSO-Access-Token oder manuellen Token)
function loadConnStatus() {
    chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, data => {
        if (data && data.ok) {
            if (data.app_name) { $('optTitle').textContent = 'OpenNIT Vault'; }
            if (data.user) { $('headerUser').textContent = data.app_name ? (data.user + ' · ' + data.app_name) : data.user; $('headerStatus').style.display = ''; }
        }
    });
}

$('btnSso').addEventListener('click', loginWithSso);
$('btnLogout').addEventListener('click', logoutSso);
reflectAuthState();
loadConnStatus();

function showStatus(msg, ok) {
    const el = $('statusMsg');
    el.innerHTML = `<div class="alert ${ok ? 'alert-success' : 'alert-danger'}">${msg}</div>`;
    setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }