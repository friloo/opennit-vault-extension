'use strict';

let allEntries  = null;
let pageMatches = [];
let entryIndex  = {};      // id -> entry
let detailState = null;    // aktiver Eintrag im Detail-Panel
let selIndex    = -1;      // Tastatur-Auswahl in der Liste

function $(id) { return document.getElementById(id); }

async function init() {
    chrome.storage.local.get(['serverUrl'], cfg => {
        if (cfg.serverUrl) $('btnOpen').href = cfg.serverUrl + '/vault';
    });

    $('search').addEventListener('input', onSearch);
    $('search').addEventListener('keydown', onListKeydown);
    $('btnOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('btnNew').addEventListener('click', openNewPanel);
    $('btnCloseNew').addEventListener('click', closeNewPanel);
    $('btnSaveNew').addEventListener('click', saveNewEntry);
    $('btnGenPw').addEventListener('click', generatePassword);
    $('btnRevealNewPw').addEventListener('click', () => {
        const f = $('nePassword');
        f.type = f.type === 'password' ? 'text' : 'password';
    });

    // Detail-Panel
    $('btnDetailBack').addEventListener('click', closeDetail);
    $('btnDetailClose').addEventListener('click', closeDetail);
    $('btnRevealUser').addEventListener('click', toggleRevealUser);
    $('btnCopyUser').addEventListener('click', () => copySecret($('detailUser').dataset.value || '', 'Benutzername kopiert'));
    $('btnRevealPass').addEventListener('click', toggleRevealPass);
    $('btnCopyPass').addEventListener('click', copyDetailPassword);
    $('btnCopyTotp').addEventListener('click', () => { const c = $('detailTotp').dataset.code || ''; if (c) copySecret(c, 'TOTP kopiert'); });
    $('btnCopyNotes').addEventListener('click', () => copyToClipboard($('detailNotes').dataset.value || '', 'Notiz kopiert'));
    $('btnDetailFill').addEventListener('click', fillActiveTab);

    // Lock-Screen
    $('lockSubmit').addEventListener('click', submitPin);
    $('lockPin').addEventListener('keydown', e => { if (e.key === 'Enter') submitPin(); });
    $('btnLock').addEventListener('click', lockNow);

    boot();
}

// Reihenfolge: Status (App/User/PIN) → Lock prüfen → Liste oder PIN-Schirm.
function boot() {
    chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, resp => {
        if (resp?.ok) {
            $('hdTitle').textContent = 'OpenNIT Vault';
            // Untertitel: angemeldeter Nutzer und – zur Orientierung – die Instanz.
            const parts = [];
            if (resp.user) parts.push(resp.user);
            if (resp.app_name) parts.push(resp.app_name);
            $('hdUser').textContent = parts.join(' · ');
        }
        chrome.runtime.sendMessage({ type: 'GET_LOCK' }, lock => {
            $('btnLock').style.display = lock?.required ? '' : 'none';
            if (lock?.required && !lock.unlocked) {
                showLockScreen();
            } else {
                hideLockScreen();
                reload(true);
            }
        });
    });
}

// ── Lock-Screen ────────────────────────────────────────────────────────────
function showLockScreen() {
    $('lockScreen').style.display = 'block';
    $('listWrap').style.display = 'none';
    $('newEntryPanel').style.display = 'none';
    $('detailPanel').style.display = 'none';
    $('search').closest('.search-wrap').style.display = 'none';
    $('lockMsg').textContent = '';
    $('lockPin').value = '';
    setTimeout(() => $('lockPin').focus(), 50);
}
function hideLockScreen() {
    $('lockScreen').style.display = 'none';
    $('search').closest('.search-wrap').style.display = '';
}
function submitPin() {
    const pin = $('lockPin').value;
    if (!pin) { $('lockMsg').textContent = 'Bitte PIN eingeben.'; return; }
    $('lockSubmit').disabled = true;
    $('lockSubmit').textContent = '…';
    $('lockMsg').textContent = '';
    chrome.runtime.sendMessage({ type: 'DO_UNLOCK', pin }, resp => {
        $('lockSubmit').disabled = false;
        $('lockSubmit').textContent = 'Entsperren';
        if (resp?.ok) {
            hideLockScreen();
            reload(true);
        } else {
            let m = resp?.error || 'PIN falsch.';
            if (resp?.lockSecs > 0) m += ' (' + resp.lockSecs + 's gesperrt)';
            $('lockMsg').textContent = m;
            $('lockPin').value = '';
            $('lockPin').focus();
        }
    });
}
function lockNow() {
    chrome.runtime.sendMessage({ type: 'LOCK_NOW' }, () => showLockScreen());
}

function reload(force) {
    closeDetailTimers();
    detailState = null;
    selIndex = -1;
    $('search').value = '';
    $('listWrap').innerHTML = '<div class="loading"><div class="spin"></div></div>';
    $('listWrap').style.display = '';
    $('newEntryPanel').style.display = 'none';
    $('detailPanel').style.display = 'none';
    $('search').closest('.search-wrap').style.display = '';

    chrome.runtime.sendMessage({ type: 'GET_ENTRIES', force }, resp => {
        // Serverseitig gesperrt (Token-Härtung) → PIN-Schirm zeigen.
        if (resp?.locked) { showLockScreen(); return; }
        allEntries = resp?.entries ?? null;
        entryIndex = {};
        if (allEntries === null) {
            $('listWrap').innerHTML = '<div class="error">&#9888; Nicht verbunden.<br>Einstellungen pr&uuml;fen.</div>';
            return;
        }
        indexEntries(allEntries);
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const url = tabs[0]?.url;
            if (url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) {
                chrome.runtime.sendMessage({ type: 'GET_MATCHING_ENTRIES', url }, r2 => {
                    pageMatches = r2?.entries || [];
                    indexEntries(pageMatches);
                    renderDefault();
                });
            } else {
                pageMatches = [];
                renderDefault();
            }
        });
    });
}

function indexEntries(list) {
    (list || []).forEach(e => { entryIndex[String(e.id)] = e; });
}

function renderDefault() {
    selIndex = -1;
    if (pageMatches.length > 0) {
        $('listWrap').innerHTML =
            '<div class="section-lbl match">Passend f&uuml;r diese Seite</div>' +
            '<div class="entries" id="eList">' + pageMatches.map(e => entryHtml(e)).join('') + '</div>';
    } else {
        $('listWrap').innerHTML =
            '<div class="section-lbl">Alle Eintr&auml;ge (' + allEntries.length + ')</div>' +
            '<div class="entries scrollable" id="eList">' +
            (allEntries.length ? allEntries.map(e => entryHtml(e)).join('') : '<div class="empty">Noch keine Eintr&auml;ge vorhanden.</div>') +
            '</div>';
    }
    const el = document.getElementById('eList');
    if (el) attachHandlers(el);
}

function onSearch() {
    selIndex = -1;
    const q = ($('search').value || '').trim().toLowerCase();
    if (!q) { renderDefault(); return; }
    if (!allEntries) return;

    const filtered = allEntries.filter(e =>
        (e.title    ||'').toLowerCase().includes(q) ||
        (e.username ||'').toLowerCase().includes(q) ||
        (e.url      ||'').toLowerCase().includes(q) ||
        (e.notes    ||'').toLowerCase().includes(q) ||
        (e.team_name||'').toLowerCase().includes(q)
    );

    $('listWrap').innerHTML =
        '<div class="section-lbl">Suche (' + filtered.length + ')</div>' +
        '<div class="entries scrollable" id="eList">' +
        (filtered.length ? filtered.map(e => entryHtml(e)).join('') : '<div class="empty">Keine Eintr&auml;ge gefunden.</div>') +
        '</div>';

    const el = document.getElementById('eList');
    if (el) attachHandlers(el);
}

// Tastatur-Navigation aus dem Suchfeld heraus (↑↓ wählt, Enter öffnet).
function onListKeydown(e) {
    if (detailState || $('newEntryPanel').style.display === 'block') return;
    const items = [...document.querySelectorAll('#eList .entry')];
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(items, selIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(items, selIndex - 1); }
    else if (e.key === 'Enter') {
        e.preventDefault();
        const target = selIndex >= 0 ? items[selIndex] : items[0];
        if (target) openDetail(target.dataset.id);
    }
}
function setSel(items, idx) {
    items.forEach(i => i.classList.remove('kbd-sel'));
    selIndex = Math.max(0, Math.min(idx, items.length - 1));
    const el = items[selIndex];
    if (el) { el.classList.add('kbd-sel'); el.scrollIntoView({ block: 'nearest' }); }
}

// ── New Entry ─────────────────────────────────────────────────────────────
function openNewPanel() {
    $('listWrap').style.display = 'none';
    $('search').closest('.search-wrap').style.display = 'none';
    $('detailPanel').style.display = 'none';
    $('newEntryPanel').style.display = 'block';
    $('neTitle').value = '';
    $('neUsername').value = '';
    $('nePassword').value = '';
    $('nePassword').type = 'password';
    $('neUrl').value = '';
    $('neNotes').value = '';
    $('newEntryMsg').textContent = '';
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const url = tabs[0]?.url;
        if (url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) {
            $('neUrl').value = url;
        }
    });
    $('neTitle').focus();
}

function closeNewPanel() {
    $('newEntryPanel').style.display = 'none';
    $('listWrap').style.display = '';
    $('search').closest('.search-wrap').style.display = '';
}

function generatePassword() {
    const len = 20;
    const sets = [
        'abcdefghijkmnopqrstuvwxyz',
        'ABCDEFGHJKLMNPQRSTUVWXYZ',
        '23456789',
        '!@#$%^&*()-_=+[]{}',
    ];
    const all = sets.join('');
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    let out = [];
    // Mindestens ein Zeichen je Set
    sets.forEach((s, i) => { out.push(s[buf[i] % s.length]); });
    for (let i = sets.length; i < len; i++) out.push(all[buf[i] % all.length]);
    // mischen
    for (let i = out.length - 1; i > 0; i--) {
        const j = buf[i] % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    $('nePassword').value = out.join('');
    $('nePassword').type = 'text';
}

async function saveNewEntry() {
    const title = $('neTitle').value.trim();
    if (!title) { $('newEntryMsg').textContent = 'Titel ist erforderlich.'; return; }

    const cfg = await new Promise(r => chrome.storage.local.get(['serverUrl', 'apiToken'], r));
    if (!cfg.serverUrl || !cfg.apiToken) { $('newEntryMsg').textContent = 'Nicht konfiguriert.'; return; }

    $('btnSaveNew').disabled = true;
    $('btnSaveNew').textContent = '...';
    $('newEntryMsg').textContent = '';

    const fd = new FormData();
    fd.append('title',    title);
    fd.append('username', $('neUsername').value.trim());
    fd.append('password', $('nePassword').value);
    fd.append('url',      $('neUrl').value.trim());
    fd.append('notes',    $('neNotes').value.trim());

    try {
        const res  = await fetch(cfg.serverUrl + '/api/vault/extension/entries', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.apiToken },
            body: fd,
        });
        const data = await res.json();
        if (data.ok) {
            chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
            closeNewPanel();
            reload(true);
            showToast('Eintrag gespeichert');
        } else {
            $('newEntryMsg').textContent = data.error || 'Fehler beim Speichern.';
        }
    } catch (e) {
        $('newEntryMsg').textContent = 'Verbindungsfehler: ' + e.message;
    }

    $('btnSaveNew').disabled = false;
    $('btnSaveNew').textContent = 'Speichern';
}

// ── Liste (Klick öffnet Detailansicht) ─────────────────────────────────────
function monogram(title) {
    const s = String(title || '?');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    const ch = s.charAt(0).toUpperCase().replace(/[&<>]/g, '');
    return { hue: h, ch: ch };
}

function entryHtml(e) {
    const userText = esc(e.username) || '<span style="color:#adb5bd;font-style:italic">Kein Benutzername</span>';
    const m = monogram(e.title);
    const icon = `<span class="entry-mono" style="display:inline-flex;width:20px;height:20px;border-radius:4px;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:hsl(${m.hue},52%,90%);color:hsl(${m.hue},55%,38%);">${m.ch}</span>`;
    const totpBadge = e.has_totp ? '<span class="entry-2fa">2FA</span>' : '';
    return `
        <div class="entry" data-id="${e.id}" data-domain="${escAttr(e.favicon_domain)}">
            <div class="entry-icon">${icon}</div>
            <div class="entry-info">
                <div class="entry-title">${esc(e.title)}${totpBadge}</div>
                <div class="entry-user">${userText}</div>
                <div class="entry-meta">
                    <div class="entry-url">${esc(e.url) || ''}</div>
                    ${e.team_name ? `<span class="team-badge">${esc(e.team_name)}</span>` : ''}
                </div>
            </div>
            <svg class="entry-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
    `;
}

function attachHandlers(container) {
    container.querySelectorAll('.entry').forEach(row => {
        row.addEventListener('click', () => openDetail(row.dataset.id));
    });
    loadFavicons(container);
}

function loadFavicons(container) {
    container.querySelectorAll('.entry[data-domain]').forEach(row => {
        if (!row.dataset.domain) return;
        const id = row.dataset.id;
        chrome.runtime.sendMessage({ type: 'GET_FAVICON', id }, resp => {
            if (resp?.dataUrl) {
                const ic = row.querySelector('.entry-icon');
                if (ic) ic.innerHTML = '<img src="' + resp.dataUrl + '" alt="">';
            }
        });
    });
}

// ── Detailansicht ─────────────────────────────────────────────────────────
function closeDetailTimers() {
    if (detailState && detailState.totpInterval) {
        clearInterval(detailState.totpInterval);
        detailState.totpInterval = null;
    }
}

function openDetail(id) {
    const e = entryIndex[String(id)];
    if (!e) return;
    closeDetailTimers();
    detailState = { id: String(id), password: null, revealUser: true, revealPass: false, totpInterval: null };

    $('listWrap').style.display = 'none';
    $('search').closest('.search-wrap').style.display = 'none';
    $('newEntryPanel').style.display = 'none';
    $('detailPanel').style.display = 'block';

    $('detailHdTitle').textContent = e.title || 'Eintrag';
    $('detailName').textContent    = e.title || '';

    // Icon: Favicon (gecacht) oder Monogramm
    const icon = $('detailIcon');
    const m = monogram(e.title);
    icon.style.background = `hsl(${m.hue},52%,90%)`;
    icon.innerHTML = `<span style="color:hsl(${m.hue},55%,38%);">${m.ch}</span>`;
    if (e.favicon_domain) {
        chrome.runtime.sendMessage({ type: 'GET_FAVICON', id }, resp => {
            if (resp?.dataUrl && detailState && detailState.id === String(id)) {
                icon.style.background = '#eef0f7';
                icon.innerHTML = '<img src="' + resp.dataUrl + '" alt="">';
            }
        });
    }

    // URL
    const urlLink = $('detailUrlLink');
    const firstUrl = String(e.url || '').split('\n')[0].trim();
    if (firstUrl) {
        urlLink.textContent = firstUrl;
        urlLink.href = /^https?:\/\//i.test(firstUrl) ? firstUrl : 'https://' + firstUrl;
        urlLink.style.display = '';
    } else {
        urlLink.style.display = 'none';
    }

    // Benutzername (standardmäßig sichtbar; Auge schaltet Maskierung)
    const uval = e.username || '';
    const uEl  = $('detailUser');
    uEl.dataset.value = uval;
    detailState.revealUser = true;
    if (uval) {
        uEl.classList.remove('empty');
        uEl.textContent = uval;
        $('btnRevealUser').style.display = '';
        $('btnCopyUser').style.display   = '';
    } else {
        uEl.classList.add('empty');
        uEl.textContent = 'Kein Benutzername';
        $('btnRevealUser').style.display = 'none';
        $('btnCopyUser').style.display   = 'none';
    }

    // Passwort (standardmäßig maskiert)
    detailState.revealPass = false;
    $('detailPass').textContent = '••••••••••';

    // Notizen
    const notes = (e.notes || '').trim();
    if (notes) {
        $('detailNotes').textContent = notes;
        $('detailNotes').dataset.value = notes;
        $('fieldNotes').style.display = '';
    } else {
        $('fieldNotes').style.display = 'none';
    }

    // TOTP
    if (e.has_totp) {
        $('fieldTotp').style.display = '';
        loadDetailTotp(String(id));
    } else {
        $('fieldTotp').style.display = 'none';
    }
}

function closeDetail() {
    closeDetailTimers();
    detailState = null;
    $('detailPanel').style.display = 'none';
    $('listWrap').style.display = '';
    $('search').closest('.search-wrap').style.display = '';
}

function toggleRevealUser() {
    const uEl = $('detailUser');
    const val = uEl.dataset.value || '';
    if (!val) return;
    detailState.revealUser = !detailState.revealUser;
    uEl.textContent = detailState.revealUser ? val : '•'.repeat(Math.min(val.length, 14));
}

async function ensurePassword(id) {
    if (detailState && detailState.password !== null) return detailState.password;
    const pw = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'GET_PASSWORD', id }, resp => resolve(resp?.password ?? null));
    });
    if (detailState && detailState.id === String(id)) detailState.password = pw || '';
    return pw || '';
}

async function toggleRevealPass() {
    const pEl = $('detailPass');
    if (detailState.revealPass) {
        detailState.revealPass = false;
        pEl.textContent = '••••••••••';
        return;
    }
    pEl.textContent = '…';
    const pw = await ensurePassword(detailState.id);
    if (!detailState) return;
    detailState.revealPass = true;
    pEl.textContent = pw || '(leer)';
}

async function copyDetailPassword() {
    const pw = await ensurePassword(detailState.id);
    if (pw) copySecret(pw, 'Passwort kopiert');
    else showToast('Kein Passwort');
}

function loadDetailTotp(id) {
    const codeEl = $('detailTotp');
    const secsEl = $('detailTotpSecs');
    const barEl  = $('detailTotpBar');
    codeEl.textContent = '…';
    codeEl.dataset.code = '';
    secsEl.textContent = '';

    chrome.runtime.sendMessage({ type: 'GET_TOTP', id }, resp => {
        if (!detailState || detailState.id !== String(id)) return;
        if (!resp?.code) { codeEl.textContent = '—'; return; }

        const apply = (code, remaining) => {
            codeEl.textContent = code.slice(0, 3) + ' ' + code.slice(3);
            codeEl.dataset.code = code;
            secsEl.textContent = remaining + 's';
            if (barEl) barEl.style.width = Math.round(remaining / 30 * 100) + '%';
        };
        apply(resp.code, resp.remaining);

        let secs = resp.remaining;
        detailState.totpInterval = setInterval(() => {
            secs--;
            if (secs <= 0) {
                chrome.runtime.sendMessage({ type: 'GET_TOTP', id }, r2 => {
                    if (!detailState || detailState.id !== String(id)) return;
                    if (r2?.code) { secs = r2.remaining; apply(r2.code, r2.remaining); }
                });
                return;
            }
            secsEl.textContent = secs + 's';
            if (barEl) {
                barEl.style.width = Math.round(secs / 30 * 100) + '%';
                barEl.style.background = secs < 10 ? '#dc3545' : '#34d399';
            }
        }, 1000);
    });
}

async function fillActiveTab() {
    if (!detailState) return;
    const e = entryIndex[detailState.id];
    if (!e) return;
    const btn = $('btnDetailFill');
    btn.disabled = true;
    const pw = await ensurePassword(detailState.id);

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            showToast('Auf dieser Seite nicht möglich');
            btn.disabled = false;
            return;
        }
        // Sicherheit: Warnen, wenn die aktive Seite NICHT zur URL des Eintrags
        // passt (verhindert versehentliches Ausfüllen auf einer fremden Domain).
        if (!fillDomainMatches(e.url, tab.url)) {
            const host = hostOf(tab.url);
            if (!window.confirm('Diese Seite (' + host + ') passt nicht zur hinterlegten Adresse des Eintrags. Zugangsdaten trotzdem hier ausfüllen?')) {
                btn.disabled = false;
                return;
            }
        }
        chrome.tabs.sendMessage(tab.id, { type: 'VAULT_FILL', id: detailState.id, username: e.username || '', password: pw || '', has_totp: !!e.has_totp }, () => {
            if (chrome.runtime.lastError) {
                showToast('Seite nicht bereit – neu laden');
                btn.disabled = false;
            } else {
                showToast('Ausgefüllt');
                setTimeout(() => window.close(), 350);
            }
        });
    });
}

// ── Helfer ────────────────────────────────────────────────────────────────
function hostOf(u) {
    try {
        const s = String(u || '');
        return new URL(s.includes('://') ? s : 'https://' + s).hostname.replace(/^www\./, '').toLowerCase();
    } catch { return ''; }
}
// True, wenn eine der (mehrzeiligen) Eintrags-URLs zur Seiten-Domain passt –
// oder wenn im Eintrag gar keine URL hinterlegt ist (dann keine Warnung).
function fillDomainMatches(entryUrls, pageUrl) {
    const pageHost = hostOf(pageUrl);
    const list = String(entryUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!list.length) return true;
    if (!pageHost) return false;
    return list.some(u => {
        let eh = hostOf(u);
        if (eh.startsWith('*.')) eh = eh.slice(2);
        return eh && (pageHost === eh || pageHost.endsWith('.' + eh) || eh.endsWith('.' + pageHost));
    });
}
function copyToClipboard(text, msg) {
    navigator.clipboard.writeText(text).then(() => showToast(msg)).catch(() => showToast('Fehler'));
}
// Wie copyToClipboard, plant aber zusätzlich das automatische Leeren der
// Zwischenablage (für Zugangsdaten/2FA).
function copySecret(text, msg) {
    navigator.clipboard.writeText(text).then(() => {
        showToast(msg);
        chrome.runtime.sendMessage({ type: 'SCHEDULE_CLIP_CLEAR', text });
    }).catch(() => showToast('Fehler'));
}
function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
}
function esc(s)     { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s||'').replace(/"/g,'&quot;'); }

init();