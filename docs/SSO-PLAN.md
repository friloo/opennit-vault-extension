# Umsetzungsplan: SSO-Anmeldung für die OpenNIT-Vault-Erweiterung

_Status: Konzept (noch nicht implementiert) · Stand 2026-07-01_

Ziel: Der Nutzer installiert die Erweiterung, gibt **nur die Server-URL** ein und **meldet sich an wie an
OpenNIT** (lokaler Login + 2. Faktor / Microsoft 365 / Keycloak). Die Erweiterung erhält daraufhin ihre
Zugangstokens **automatisch** – kein manuelles Kopieren mehr. Kurz vor Ablauf fordert die Erweiterung eine
erneute Anmeldung (Re-Auth).

Dieses Dokument ist der **gründliche Umsetzungsplan** – kein Code.

---

## 1. Leitidee

**OpenNIT wird zum OAuth-2.0-Autorisierungsserver für seine eigene Erweiterung.**

Die Erweiterung ist ein **öffentlicher OAuth-Client** (kein Client-Secret) und spricht **ausschließlich mit
OpenNIT** – nicht direkt mit Microsoft/Keycloak. Wie sich der Nutzer bei OpenNIT anmeldet (lokal + TOTP/
WebAuthn, Azure AD, Keycloak), ist für die Erweiterung **transparent**: Sie nutzt einfach die bestehende
OpenNIT-Login-Seite. Das löst automatisch **alle** Anmeldemethoden mit einem einzigen Extension-Flow.

Verwendeter Standard: **OAuth 2.0 Authorization Code Flow mit PKCE** (RFC 7636), umgesetzt über die
Browser-API **`chrome.identity.launchWebAuthFlow`**.

> Bereits vorhandene Bausteine in OpenNIT, auf denen aufgesetzt wird:
> `src/Auth/OAuthClient.php` (OIDC/PKCE zu Azure/Keycloak), `src/Auth/TokenManager.php`,
> `src/Auth/SessionManager.php`, `src/Controllers/AuthController.php` (lokaler + Azure + Keycloak Login),
> `src/Vault/VaultManager.php` (`unlockOrSetup`, `unlockOrSetupSso`, `storeVmkInSession`,
> `getVmkFromSession`, PIN-Entsperrung), sowie das bestehende Token-Modell in
> `src/Controllers/VaultApiController.php` (`tokenGenerate`, VMK-Wrapping via `deriveKeyFromToken`).

---

## 2. Zwei Token-Typen (statt einem 180-Tage-Token)

| Token | Lebensdauer (Vorschlag) | Speicherort | Zweck |
|-------|-------------------------|-------------|-------|
| **Access-Token** | kurz (15–60 Min) | `chrome.storage.session` (flüchtig) | Bearer für alle `/api/vault/extension/*`-Aufrufe |
| **Refresh-Token** | lang (14–30 Tage, rotierend) | `chrome.storage.local` | Holt still neue Access-Tokens; wird bei jeder Nutzung **rotiert** |

Vorteile gegenüber dem heutigen manuellen 180-Tage-Token:
- Ein gestohlener **Access-Token** verfällt in Minuten.
- Der **Refresh-Token rotiert** bei jeder Nutzung → **Diebstahl-Erkennung** (Reuse Detection).
- **Kein Copy-&-Paste** eines langlebigen Geheimnisses.
- **Zentraler Widerruf** über die Web-Oberfläche (Sitzungen beenden).
- Kombinierbar mit dem bereits umgesetzten **serverseitigen PIN-Gate** (Defense in Depth).

---

## 3. Der VMK-Kern (wichtigster Design-Punkt)

OpenNIT ver-/entschlüsselt Tresor-Einträge serverseitig mit dem **Vault Master Key (VMK)**. Jeder
Extension-Token muss den VMK also (server-seitig) verfügbar machen. Heute wrappt `tokenGenerate` den VMK
unter einem aus dem Token abgeleiteten Schlüssel.

**Herausforderung:** Beim **stillen Refresh** (ohne Nutzerinteraktion, ohne Passwort) muss der Server den
VMK weiterhin bereitstellen können.

**Lösung – VMK „wandert" mit dem Refresh-Token:**

1. **Bei der Erstanmeldung** (Authorization-Code-Grant) ist der Web-Login gerade erfolgt → der VMK liegt in
   der Session (lokaler Login entsperrt per Passwort; SSO-Nutzer per `unlockOrSetupSso`). Der Server:
   - wrappt den VMK unter einem aus dem **Refresh-Token** abgeleiteten Schlüssel → speichert ihn in der
     Refresh-Zeile,
   - wrappt den VMK unter einem aus dem **Access-Token** abgeleiteten Schlüssel → Access-Zeile (kurzlebig).
2. **Beim Refresh:** Server entpackt den VMK mit dem Refresh-Schlüssel, **rotiert** (neuer Refresh-Token,
   VMK neu gewrappt, alter Token als „rotiert" markiert), gibt einen neuen Access-Token (VMK gewrappt) aus.

Damit ist der **Refresh-Token** faktisch das langlebige VMK-tragende Geheimnis (wie heute der manuelle
Token) – aber **kürzerlebig, rotierend, per SSO bezogen und widerrufbar**. Der **Access-Token** ist das
kurzlebige Arbeitspferd.

> Hinweis PIN-Gate: Das serverseitige PIN-Gate (bereits umgesetzt) bleibt orthogonal bestehen – auch mit
> gültigem Access-Token liefern die Secret-Endpunkte bei aktivem Tresor-PIN erst nach PIN-Entsperrung.
> Ob das PIN-Gate bei SSO zusätzlich gefordert wird, ist eine Betreiber-Entscheidung (siehe §9).

---

## 4. Ablauf (Sequenz)

```
Erweiterung                         OpenNIT (AS)                         IdP (M365/Keycloak/lokal)
     │                                   │                                        │
     │ 1. launchWebAuthFlow(authorize?   │                                        │
     │    client_id, redirect_uri,       │                                        │
     │    code_challenge, state, scope)  │                                        │
     │──────────────────────────────────▶│                                        │
     │                                   │ 2. Keine Session? → /auth/login         │
     │                                   │────────── Login (lokal+2FA/SSO) ───────▶│
     │                                   │◀───────────── authentifiziert ─────────│
     │                                   │ 3. Vault entsperrt? sonst PIN-Prompt    │
     │                                   │ 4. Zustimmung („Vault-Zugriff erlauben")│
     │◀── 5. Redirect: redirect_uri?code=…&state ─┤                               │
     │ 6. state prüfen, code extrahieren │                                        │
     │ 7. POST /oauth/token              │                                        │
     │    (code, code_verifier)          │                                        │
     │──────────────────────────────────▶│ 8. PKCE prüfen, VMK wrappen            │
     │◀── {access_token, refresh_token, expires_in, refresh_expires_in} ──────────┤
     │ 9. Tokens speichern, loslegen     │                                        │
     │        …                           │                                        │
     │ 10. Access-Token abgelaufen → POST /oauth/token (grant=refresh_token)       │
     │──────────────────────────────────▶│ 11. rotieren, neuen Access ausgeben    │
     │◀───────────────────────────────────┤                                       │
```

Silent-Refresh (Schritt 10/11) läuft unsichtbar. Erst wenn der **Refresh-Token abläuft** oder der Refresh
scheitert, startet die Erweiterung erneut `launchWebAuthFlow` – bei noch lebender OpenNIT/IdP-Sitzung ist
das ein **stiller Redirect ohne Eingabe**, sonst ein voller Login.

---

## 5. Neue Server-Endpunkte

Alle unter `/api/vault/extension/oauth/`:

| Methode & Pfad | Auth | Zweck |
|----------------|------|-------|
| `GET  /authorize` | Web-Session (Login-Redirect) | Zeigt Zustimmung, ggf. PIN-Entsperrung; erzeugt Auth-Code |
| `POST /token`     | öffentlich (PKCE) | `grant_type=authorization_code` **oder** `refresh_token` → Access/Refresh |
| `POST /revoke`    | Bearer/Refresh | Widerruft einen Refresh-Token (Logout in der Erweiterung) |
| `GET  /sessions` (Web) | Web-Session | Liste aktiver Erweiterungs-Sitzungen im Web-Vault |
| `POST /sessions/{id}/revoke` (Web) | Web-Session | Einzelne Sitzung serverseitig beenden |

Bestehende Endpunkte (`/entries`, `/entries/{id}/password`, `/totp`, `/favicon`, `/status`, `/unlock`,
`/lock`) bleiben unverändert – sie akzeptieren künftig **Access-Tokens** genauso wie die bisherigen
manuellen Tokens (siehe §8 Kompatibilität).

---

## 6. Datenmodell (neue Migrationen)

**`vault_oauth_auth_codes`** (kurzlebige Autorisierungscodes)
```
code_hash        CHAR(64) PK      -- sha256(code)
user_id          BIGINT
code_challenge   VARCHAR(128)     -- PKCE (S256)
redirect_uri     VARCHAR(255)
scope            VARCHAR(255)
expires_at       DATETIME         -- ~60 Sekunden
used_at          DATETIME NULL    -- Einmalverwendung
created_at       DATETIME
```

**`vault_oauth_refresh_tokens`** (langlebig, VMK-tragend, rotierend)
```
id               BIGINT PK
user_id          BIGINT
token_hash       CHAR(64)         -- sha256(refresh_token)
vmk_enc/nonce/tag                 -- VMK gewrappt unter Refresh-Schlüssel (HKDF)
device_label     VARCHAR(120)     -- z. B. "Chrome auf Laptop"
rotated_from     BIGINT NULL      -- Vorgänger (Reuse-Detection-Kette)
revoked          TINYINT DEFAULT 0
refresh_expires_at DATETIME       -- absolutes Ablaufdatum (14–30 Tage)
created_at, last_used_at DATETIME
```

**Access-Tokens:** die vorhandene Tabelle `vault_extension_tokens` weiternutzen (kurzes `expires_at`,
`unlocked_until` für das PIN-Gate). Optional Spalte `refresh_id` (Herkunft) für Bulk-Revoke.

**Client-Registrierung:** ein fester `client_id` für die Erweiterung + erlaubte Redirect-URIs, konfiguriert
in `system_settings` bzw. einer kleinen `vault_oauth_clients`-Tabelle (Admin-GUI, siehe §7).

---

## 7. Admin-Konfiguration (Pflicht laut OpenNIT-Konventionen)

Neue Admin-Seite `/admin/vault/extension` (Layout `layouts/admin`, Capability `manage_vault_*`), nur bei
aktivem Vault-Modul:
- **Extension-Client-ID** (Vorgabe fix) und **erlaubte Redirect-URIs**. Empfehlung: die konkrete
  `https://<extension-id>.chromiumapp.org/` **pinnen** (Store-ID bzw. Unpacked-ID), statt Wildcard.
- **Token-Lebensdauern**: Access (15–60 Min), Refresh (14–30 Tage), Re-Auth-Vorwarnung (Tage).
- **SSO-Login in der Erweiterung**: an/aus; welche Methoden angeboten werden (erbt aus dem Web-Login).
- **PIN-Gate bei SSO**: zusätzlich fordern (Defense in Depth) oder bei erfolgreichem SSO überspringen.
- Übersicht/Widerruf aktiver Sitzungen.

Alle Werte in der DB (`system_settings`), nicht in Config-Dateien (OpenNIT-Regel). Secrets nie ins Audit-Log.

---

## 8. Erweiterungs-Seite (Client)

- Manifest: Berechtigung **`identity`** ergänzen; Redirect-URI ist `chrome.identity.getRedirectURL()`
  (`https://<id>.chromiumapp.org/`).
- **Options/Popup:** Button **„Mit OpenNIT anmelden"** (nach Eingabe der Server-URL). Startet
  `launchWebAuthFlow({interactive:true})`.
- **Token-Haltung:** Refresh-Token in `chrome.storage.local`, Access-Token + Ablauf in
  `chrome.storage.session`.
- **Auto-Refresh:** Der Background-Service-Worker hält den Access-Token frisch; vor jedem API-Call bei
  Ablauf still refreshen. Bei `401`/abgelaufenem Refresh → interaktiver Re-Login.
- **Re-Auth-Vorwarnung:** X Tage vor `refresh_expires_at` ein dezenter Hinweis „Bitte neu anmelden".
- **PKCE/State** clientseitig erzeugen (Web Crypto). `state` gegen CSRF prüfen.
- **Logout:** `POST /oauth/revoke` + lokale Tokens löschen.

---

## 9. Sicherheitsdesign & Bedrohungsmodell

**Was SSO verbessert (ggü. manuellem Token):**
- Kein langlebiges Klartext-Geheimnis zum Kopieren.
- Access-Tokens kurzlebig; Refresh-Tokens **rotieren** → Reuse-Detection: Wird ein bereits rotierter
  Refresh-Token erneut vorgelegt, wird die **gesamte Kette widerrufen** und Re-Login erzwungen (+ Audit-Alarm).
- Wiederverwendung der **vorhandenen Anmeldung inkl. 2. Faktor** (M365/Keycloak/lokal+TOTP/WebAuthn).
- **Zentraler Widerruf** je Gerät/Sitzung.

**Pflicht-Härtungen im Flow:**
- **PKCE (S256)** – öffentlicher Client, kein Secret.
- **Redirect-URI-Allowlist** (Extension-ID pinnen).
- **`state`** gegen CSRF; **Auth-Code** einmalig, ~60 s gültig, an PKCE-Challenge + redirect_uri + user gebunden.
- **Rate-Limiting** auf `/authorize`, `/token` (bestehender RateLimiter greift; zusätzlich pro Nutzer/Client).
- **Audit-Log** für Ausgabe/Refresh/Rotation/Reuse/Revoke.
- **Nur HTTPS** (bereits in der Erweiterung erzwungen).

**Was bestehen bleibt (bewusst):**
- Der **Refresh-Token ist VMK-tragend „at rest"** in `chrome.storage.local` – wie heute der Token.
  Restrisiko gemindert durch: Rotation, kürzere Lebensdauer, **PIN-Gate**, optionales **Geräte-Binding**
  (client-generierte Device-ID als zusätzlicher Faktor beim Refresh), und schnellen Widerruf.
- `chrome.storage` ist nicht hardware-gebunden – ein vollständig kompromittiertes Endgerät bleibt ein
  vollständig kompromittiertes Endgerät (gilt für jeden Passwort-Manager).
- Der Server kann prinzipbedingt den VMK entpacken (nötig für serverseitige Krypto). DB-Zugriff = Vollzugriff
  (unverändert; separat durch DB-/Server-Härtung zu adressieren).

---

## 10. Kompatibilität & Migration

- **Manuelle Tokens bleiben gültig** (Tabelle `vault_extension_tokens`) – kein Bruch bestehender
  Installationen. Der SSO-Flow ist **additiv**.
- Die Secret-Endpunkte akzeptieren Access-Tokens **und** Alt-Tokens (dieselbe `authenticateByToken`-Logik,
  ergänzt um Access-Token-Lookup).
- Options-Seite: **„Mit OpenNIT anmelden"** wird der Standardweg; **manueller Token** wandert unter
  „Erweitert" (für Umgebungen ohne interaktiven Login, z. B. Kiosk/Headless).
- Empfehlung: nach Einführung die Standard-Laufzeit manueller Tokens verkürzen.

---

## 11. Phasenplan & Aufwand (grob)

| Phase | Inhalt | Aufwand |
|-------|--------|---------|
| **0. Feinkonzept** | Endpunkt-/DB-Spezifikation, Admin-Settings festzurren, Lebensdauern | 0,5–1 Tag |
| **1. Server-AS** | `authorize`/`token`/`revoke`, Migrationen, VMK-Wrapping+Rotation, Reuse-Detection, Audit | 3–5 Tage |
| **2. Admin-GUI** | Client-/Redirect-Config, Lebensdauern, Sitzungsübersicht/Widerruf | 1–2 Tage |
| **3. Erweiterung** | `identity`-Flow, Token-Haltung, Auto-Refresh, Re-Auth-UX, Logout | 2–3 Tage |
| **4. Härtung & Test** | Rate-Limits, Edge-Cases (PIN-gesperrter Vault beim authorize, SSO-only-Nutzer), End-to-End-Tests | 1–2 Tage |
| **5. Doku & Rollout** | Handbuch, Store-Update, Deprecation-Hinweis manueller Token | 0,5–1 Tag |

**Gesamt: ~1,5–2,5 Wochen** für eine solide erste Version. Da OAuth/PKCE-Infrastruktur (`OAuthClient`,
`TokenManager`) und der Vault-Unlock (`unlockOrSetupSso`) bereits existieren, ist ein Teil der Grundlage da.

---

## 12. Edge-Cases, die das Feinkonzept klären muss

- **PIN-gesperrter Vault beim `authorize`**: Ist der Web-Vault gerade PIN-gesperrt, liegt der VMK nicht in
  der Session → im Consent-Schritt PIN-Entsperrung verlangen (vorhandener PIN-Flow).
- **SSO-only-Nutzer** (kein lokales Passwort): VMK-Bereitstellung über `unlockOrSetupSso` – am `authorize`
  bereits gegeben, da der Login gerade lief.
- **Team-Schlüssel**: `provisionPendingTeamKeys` beim Token-Issuing berücksichtigen (wie heute).
- **Mehrere Geräte**: pro Gerät eine Refresh-Kette (`device_label`), unabhängig widerrufbar.
- **Passwortänderung / VMK-Rotation** serverseitig: bestehende Refresh-Tokens ggf. invalidieren → Re-Login.
- **Uhrzeit/Ablauf**: absolute Ablaufzeiten serverseitig führend.

---

## 13. Offene Entscheidungen (für dich)

1. **Lebensdauern**: Access-Token (15/30/60 Min?) und Refresh-Token (14/30 Tage?) + Re-Auth-Vorwarnung (Tage?).
2. **Manuellen Token behalten** (als „Erweitert"-Fallback) oder mittelfristig entfernen?
3. **PIN-Gate bei SSO**: zusätzlich fordern (max. Sicherheit) oder nach erfolgreichem SSO überspringen (Komfort)?
4. **Redirect-URI**: Extension-ID pinnen (empfohlen) vs. `*.chromiumapp.org` erlauben?
5. **Geräte-Binding** des Refresh-Tokens umsetzen (empfohlen) – ja/nein?
6. **Angebotene Login-Methoden** in der Erweiterung: alle aus dem Web-Login (lokal+2FA / Azure / Keycloak)?

> Sobald diese sechs Punkte entschieden sind, kann Phase 0 (Feinkonzept mit exakten Endpunkt- und
> DB-Spezifikationen) beginnen.
