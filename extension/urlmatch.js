'use strict';

/*
 * Gemeinsame Zuordnung Eintrag ↔ Seite.
 *
 * Wird in allen drei Kontexten geladen (Service Worker via importScripts,
 * Popup via <script>, Seiten via content_scripts) – damit Vorschlagsliste und
 * Sicherheitswarnung dieselbe Regel anwenden.
 *
 * Regel: Ein Eintrag passt zu einer Seite, wenn deren Host dem hinterlegten Host
 * entspricht oder eine Subdomain davon ist. Die Gegenrichtung gilt bewusst nicht –
 * ein Eintrag für `vpn.firma.de` passt nicht zu `firma.de`.
 */
var VaultUrl = (function () {
    /**
     * Host einer Adresse in vergleichbarer Form (klein, ohne `www.`).
     * @param {string} raw  Adresse mit oder ohne Schema
     * @return {string} Host oder '' wenn nicht bestimmbar
     */
    function host(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        try {
            return new URL(s.includes('://') ? s : 'https://' + s).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            return s.replace(/^www\./, '').toLowerCase();
        }
    }

    /** Hinterlegte Adressen eines Eintrags (mehrzeilig) als Liste. */
    function list(entryUrls) {
        if (Array.isArray(entryUrls)) return entryUrls.map(u => String(u || '').trim()).filter(Boolean);
        return String(entryUrls || '').split('\n').map(u => u.trim()).filter(Boolean);
    }

    /**
     * Passt einer der hinterlegten Hosts zur Seite?
     * @param {string|string[]} entryUrls  Adressen des Eintrags
     * @param {string} pageUrl  Adresse der Seite
     * @return {boolean}
     */
    function matches(entryUrls, pageUrl) {
        const pageHost = host(pageUrl);
        if (!pageHost) return false;
        return list(entryUrls).some(raw => {
            let eh = host(raw);
            if (eh.startsWith('*.')) eh = eh.slice(2);
            if (!eh) return false;
            return pageHost === eh || pageHost.endsWith('.' + eh);
        });
    }

    /** Wie `matches`, wertet einen Eintrag ohne hinterlegte Adresse aber als passend. */
    function matchesOrUnset(entryUrls, pageUrl) {
        if (!list(entryUrls).length) return true;
        return matches(entryUrls, pageUrl);
    }

    return { host, list, matches, matchesOrUnset };
})();

// Im Service Worker steht `self` zur Verfügung, im Popup/Content-Script `window`.
if (typeof self !== 'undefined') self.VaultUrl = VaultUrl;
