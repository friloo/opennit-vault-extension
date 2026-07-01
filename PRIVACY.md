# Datenschutzerklärung – OpenNIT Vault (Browser-Erweiterung)

_Stand: 2026-07-01 · Version 2.2.2_

> Kurzfassung: Die Erweiterung sendet Daten **ausschließlich** an die von dir konfigurierte
> OpenNIT-Instanz. Es gibt **keine** Telemetrie, **keine** Analyse-/Tracking-Dienste, **keine**
> Drittanbieter-Server und **keinen** Verkauf oder Weitergabe von Daten.

## 1. Verantwortlicher

Betreiber der Erweiterung ist der Betreiber der jeweiligen **OpenNIT-Instanz**, mit der sich die
Erweiterung verbindet (in der Regel dein Arbeitgeber oder du selbst). Die Erweiterung selbst ist ein
technisches Client-Werkzeug ohne eigenen Server.

## 2. Welche Daten verarbeitet die Erweiterung?

| Datum | Zweck | Speicherort |
|-------|-------|-------------|
| **Server-URL** | Adresse deiner OpenNIT-Instanz | lokal (`chrome.storage.local`) |
| **API-Token** | Authentifizierung gegenüber deiner Instanz | lokal (`chrome.storage.local`) |
| **Einstellungen** (PIN-Sperrdauer, Zwischenablage-Option) | Verhalten der Erweiterung | lokal (`chrome.storage.local`) |
| **Entsperr-Status** | Merkt, ob die PIN-Sperre entsperrt ist | Sitzungsspeicher (`chrome.storage.session`, wird beim Schließen des Browsers gelöscht) |
| **Tresor-Einträge** (Titel, Benutzername, URL, Notizen, ob 2FA vorhanden) | Anzeige & Suche | flüchtig im Arbeitsspeicher (max. 5 Min zwischengespeichert) |
| **Passwörter / 2FA-Codes** | Autofill & Kopieren | flüchtig, **nur im Moment der Nutzung** vom Server abgerufen; nicht dauerhaft gespeichert |
| **Aktive Tab-Adresse** | Passende Vorschläge zur aufgerufenen Seite | flüchtig, nicht gespeichert, nicht übertragen (außer als Teil der API-Abfrage an deine Instanz) |

Die Erweiterung erstellt **keine** Nutzungsprofile und protokolliert **kein** Surfverhalten.

## 3. Datenübermittlung

- Es werden Daten **ausschließlich** an die von dir eingetragene **OpenNIT-Server-URL** übertragen
  (verschlüsselt via HTTPS, sofern deine Instanz HTTPS nutzt).
- Übertragen werden: der API-Token (zur Authentifizierung), die aktuelle Seiten-Adresse (zum Finden
  passender Einträge), sowie beim Anlegen neuer Einträge die von dir eingegebenen Felder.
- Es erfolgt **keine** Übermittlung an Anthropic, Google (außer der Chrome-Sync deines eigenen Browsers,
  falls du ihn aktiviert hast) oder sonstige Dritte.

## 4. Berechtigungen und warum sie nötig sind

Siehe [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md). Kurz:

- **Zugriff auf alle Websites** (`host_permissions: <all_urls>`): nötig, um Login-Felder auf beliebigen
  Seiten zu erkennen und auf Wunsch auszufüllen. Es werden **keine** Seiteninhalte gelesen oder
  übertragen, außer den zum Ausfüllen nötigen Formularfeldern – und diese verlassen den Browser nicht.
- **storage**: lokale Speicherung von URL, Token und Einstellungen.
- **scripting / activeTab**: Einfügen der Zugangsdaten in das aktive Tab-Formular.
- **alarms / offscreen**: automatisches Leeren der Zwischenablage nach dem Kopieren.

## 5. Zwischenablage

Kopierte Passwörter und 2FA-Codes werden – sofern aktiviert – nach etwa 30 Sekunden automatisch aus der
Zwischenablage entfernt.

## 6. Speicherdauer

- Server-URL, Token und Einstellungen bleiben lokal gespeichert, bis du sie änderst oder die Erweiterung
  entfernst.
- Zwischengespeicherte Einträge werden spätestens nach 5 Minuten bzw. beim Sperren verworfen.
- Passwörter/2FA-Codes werden nicht dauerhaft gespeichert.

## 7. Deine Rechte

Da die eigentliche Datenverarbeitung in deiner OpenNIT-Instanz stattfindet, richten sich Auskunfts-,
Lösch- und Berichtigungsrechte an deren Betreiber. Lokale Daten der Erweiterung entfernst du durch
Deinstallieren der Erweiterung oder Löschen des Tokens in den Einstellungen.

## 8. Kontakt

Wende dich an den Betreiber deiner OpenNIT-Instanz. Für die Store-Veröffentlichung muss der Publisher hier
eine erreichbare Kontaktadresse ergänzen.

---

# Privacy Policy – OpenNIT Vault (Browser Extension)

> Summary: The extension communicates **only** with the OpenNIT instance you configure. **No** telemetry,
> **no** analytics/tracking, **no** third-party servers, **no** sale or sharing of data.

**Controller.** The operator of the OpenNIT instance you connect to. The extension itself has no server.

**Data processed.** Server URL, API token and settings (stored locally); unlock state (session storage,
cleared when the browser closes); vault entry metadata (title, username, URL, notes, whether 2FA exists –
cached in memory for up to 5 minutes); passwords/2FA codes (fetched **only** at the moment of use, never
stored permanently); the active tab URL (to find matching entries).

**Transmission.** Data is sent **only** to your configured OpenNIT server URL over HTTPS. Nothing is sent
to Anthropic, Google or any third party.

**Permissions.** Broad host access is required to detect and fill login fields on arbitrary sites; page
content is not read or transmitted beyond the form fields needed for autofill, which never leave the
browser. See [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md).

**Clipboard.** Copied passwords/2FA codes are cleared automatically after ~30 seconds (if enabled).

**Retention.** Local settings persist until changed or the extension is removed; cached entries expire
within 5 minutes; secrets are never stored persistently.

**Your rights.** Because processing happens in your OpenNIT instance, direct data-subject requests to its
operator. Remove local extension data by uninstalling the extension or clearing the token.
