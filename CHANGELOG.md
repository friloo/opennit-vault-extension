# Changelog – OpenNIT Vault (Browser-Erweiterung)

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Die Erweiterungsversion (`manifest.json`) ist unabhängig von der OpenNIT-Serverversion.

## [2.4.0] - 2026-07-01

### Hinzugefügt
- **SSO-Anmeldung (OAuth 2.0 + PKCE):** „Mit OpenNIT anmelden" – Anmeldung wie an OpenNIT
  (lokal + 2FA / Microsoft 365 / Keycloak) über `chrome.identity`. Die Erweiterung erhält kurzlebige
  Access-Tokens und einen langlebigen, **rotierenden** Refresh-Token; der Zugang wird automatisch erneuert.
  „Abmelden" widerruft die Sitzung serverseitig.
- Der bisherige **manuelle Token** bleibt als „Erweitert"-Option erhalten (Kiosk/Headless).

### Sicherheit
- Kurzlebige Access-Tokens + Refresh-Token-**Rotation mit Reuse-Detection** (bei Wiederverwendung eines
  bereits rotierten Tokens wird die gesamte Sitzungskette widerrufen).

## [2.3.0] - 2026-07-01

### Sicherheit
- **Token-Härtung:** Bei aktivem Tresor-PIN wird die PIN-Sperre nun **serverseitig erzwungen** – die
  Endpunkte für Einträge/Passwort/TOTP liefern erst nach frischer PIN-Entsperrung Daten. Ein gestohlener
  Token allein ist damit wertlos, solange keine gültige Entsperrung vorliegt (neuer `POST /unlock`
  mit Fensterdauer, `POST /lock` zum sofortigen Sperren).
- **HTTPS-Zwang:** In den Einstellungen werden nur noch `https://`-Adressen akzeptiert (Ausnahme:
  `localhost`) – verhindert Klartext-Übertragung von Token und Passwörtern.
- **Warnung bei fremder Domain:** „Auf dieser Seite ausfüllen" warnt, wenn die aktive Seite nicht zur
  hinterlegten Adresse des Eintrags passt.

### Geändert
- Die Einstellung „PIN-Sperre" legt nur noch die **Dauer** der Entsperrung fest (die Option „Aus" entfällt,
  da die Sperre bei gesetztem Tresor-PIN serverseitig gilt).

## [2.2.2] - 2026-07-01

### Geändert
- Fester Name **„OpenNIT Vault"** (unabhängig vom Instanznamen).
- Berechtigung **`tabs` entfernt** – die aktive Tab-Adresse ist bereits durch die Website-Berechtigungen
  abgedeckt; die Warnung „Browserverlauf lesen" entfällt.

## [2.2.0] - 2026-07-01

### Hinzugefügt
- **PIN-Sperre** mit demselben PIN wie der Web-Tresor, konfigurierbare Sperrdauer (5 Min / 15 Min /
  1 Std / bis der Browser geschlossen wird).
- **Passwort-Generator** und Anzeigen-Auge beim Anlegen.
- **Notizen** in der Detailansicht (anzeigen/kopieren) und in der Suche.
- **Zwischenablage-Auto-Clear** nach dem Kopieren (abschaltbar).
- **Tastatur-Navigation** in der Liste und **Dark Mode**.

## [2.1.0] - 2026-06-30

### Hinzugefügt
- **Detailansicht** je Eintrag mit Anzeigen/Kopieren von Benutzername und Passwort sowie 2FA-Code.
- **Favicons** der hinterlegten Seiten (serverseitig gecacht).

### Behoben
- Klick auf einen Eintrag öffnet nun die Detailansicht.
- Vorschlags-Dropdown an das Design der Erweiterung angeglichen.

## [2.0.0]

### Hinzugefügt
- Erstveröffentlichung: Autofill für Benutzer-, Passwort- und 2FA-Felder, Popup mit Liste/Suche,
  Anlegen neuer Einträge, Einstellungen für Server-URL und Token.
