# Leonhards Familienkalender – einfache Einrichtung

Diese Version ist so aufgebaut, dass **nur der Eigentümer einmalig GitHub und Supabase einrichtet**. Mama, Oma und weitere Mitglieder benutzen danach ausschließlich die Web-App. Sie müssen weder SQL ausführen noch ein Supabase-Konto besitzen.

## Was enthalten ist

- Anmeldung mit E-Mail und Passwort
- Einrichtungsassistent in der Weboberfläche
- Rollen: Eigentümer, Administrator und Mitglied
- Einladungscode, gebunden an die E-Mail-Adresse
- Mitglieder, Rollen, Namen und Farben im Admin-Bereich verwalten
- Tages-, Wochen- und Aufgabenansicht
- Schule, Betreuung, Fahrdienst, Termin und Bettgehzeit
- beliebige Erinnerungszeiten in Minuten
- Serientermine und einzelne Ausnahmen
- installierbare PWA
- vorbereitete echte Push-Benachrichtigungen

---

# Teil A – einmalig durch den Eigentümer

## 1. Supabase-Projekt anlegen

1. Bei Supabase ein neues Projekt anlegen.
2. Im **SQL Editor** eine neue Abfrage öffnen.
3. Den kompletten Inhalt von `supabase.sql` hineinkopieren und einmal ausführen.
4. Unter **Authentication → Providers** E-Mail/Passwort aktivieren.
5. Für einen einfachen Start kann unter Authentication eingestellt werden, ob neue E-Mail-Adressen erst bestätigt werden müssen.

Das SQL wird nur einmal von dir ausgeführt. Familienmitglieder müssen das niemals tun.

## 2. Zugangsdaten in die Webseite eintragen

In Supabase unter **Project Settings → API** kopieren:

- Project URL
- anon/public key

Dann `config.js` öffnen und einsetzen:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://DEIN-PROJEKT.supabase.co",
  SUPABASE_ANON_KEY: "DEIN-ANON-KEY",
  VAPID_PUBLIC_KEY: "",
  APP_NAME: "Leonhards Familienkalender"
};
```

Der `service_role`-Schlüssel darf niemals in `config.js` oder GitHub stehen.

## 3. GitHub Pages veröffentlichen

1. Ein neues GitHub-Repository erstellen.
2. Alle Dateien aus diesem Ordner hochladen.
3. In GitHub **Settings → Pages** öffnen.
4. **Deploy from a branch**, Branch `main`, Ordner `/root` auswählen.
5. Die angezeigte GitHub-Pages-Adresse öffnen.
6. Diese Adresse in Supabase unter **Authentication → URL Configuration** als Site URL und Redirect URL eintragen.

## 4. Ersten Zugang anlegen

1. Die veröffentlichte Webseite öffnen.
2. **Neues Konto anlegen** auswählen.
3. Mit deiner E-Mail registrieren und gegebenenfalls die E-Mail bestätigen.
4. Anmelden.
5. **Neue Familie erstellen** auswählen.
6. Einen Namen eingeben, beispielsweise „Leonhards Familienkalender“.

Du wirst automatisch Eigentümer.

---

# Teil B – Frau oder Oma einladen

## Was du als Eigentümer machst

1. In der App unten **Admin** öffnen.
2. Unter **Mitglied einladen** die E-Mail-Adresse der Person eingeben.
3. **Einladungscode erzeugen** drücken.
4. Den angezeigten Code weitergeben.

## Was die eingeladene Person macht

1. Die normale Kalender-Webseite öffnen.
2. **Neues Konto anlegen** wählen.
3. Genau die E-Mail-Adresse verwenden, für die der Einladungscode erstellt wurde.
4. Anmelden.
5. **Mit Einladungscode beitreten** drücken.
6. Code eingeben und **Beitreten** drücken.

Danach erscheint sofort der gemeinsame Kalender. Es ist kein Supabase-Zugang, kein SQL und keine GitHub-Einrichtung erforderlich.

Der Code ist sieben Tage gültig und an die E-Mail-Adresse gebunden.

---

# Rollen

## Eigentümer

- vollständige Kontrolle
- Administratoren ernennen
- Eigentümerrolle übertragen
- Mitglieder, Einladungen, Farben und Rollen verwalten
- komplette Serien ändern oder löschen

## Administrator

- Kalender und Serien verwalten
- Mitglieder einladen
- normale Mitglieder verwalten
- keine Eigentümerrolle vergeben oder entziehen

## Mitglied

- Kalender sehen
- Termine anlegen
- eigene oder zugewiesene Aufgaben bearbeiten
- eigene Farbe, Benachrichtigungen und Standard-Vorlaufzeit einstellen

Die Rechte werden zusätzlich in der Supabase-Datenbank abgesichert.

---

# Push-Benachrichtigungen einrichten

Dieser Teil wird ebenfalls nur einmal vom Eigentümer eingerichtet.

## 1. VAPID-Schlüssel erzeugen

Ein VAPID-Schlüsselpaar erzeugen. Den öffentlichen Schlüssel in `config.js` als `VAPID_PUBLIC_KEY` eintragen.

## 2. Edge Function bereitstellen

Die Funktion liegt unter:

`supabase/functions/send-reminders/index.ts`

Mit der Supabase CLI bereitstellen:

```bash
supabase functions deploy send-reminders --no-verify-jwt
```

In Supabase als Function Secrets hinterlegen:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`, zum Beispiel `mailto:deine-adresse@example.de`
- `CRON_SECRET`, ein selbst gewähltes langes Kennwort

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stehen Edge Functions normalerweise als Umgebungsvariablen zur Verfügung.

## 3. Minütlichen Aufruf einrichten

Die Edge Function muss einmal pro Minute aufgerufen werden. Dabei muss der Header `x-cron-secret` den Wert deines `CRON_SECRET` enthalten.

## 4. Auf jedem Handy aktivieren

Jede Person öffnet in der App:

**Mehr → Benachrichtigungen → Push auf diesem Gerät aktivieren**

Auf dem iPhone muss die Webseite zuerst in Safari über **Teilen → Zum Home-Bildschirm** installiert und danach über das App-Symbol geöffnet werden.

Die Erinnerung wird nur an Personen geschickt, die beim Termin als zuständig, bringt oder holt eingetragen sind. Beispiele:

- Abholen in 15 Minuten
- Bettgehzeit in 5 Minuten

---

# Dateien

- `index.html` – Oberfläche
- `styles.css` – Gestaltung
- `app.js` – Kalender-, Rollen- und Einladungslogik
- `config.js` – Supabase- und Push-Konfiguration
- `supabase.sql` – Datenbank und sichere Berechtigungen
- `service-worker.js` – Installation, Offline-Grundfunktion und Push-Anzeige
- `manifest.webmanifest` – PWA-Einstellungen
- `supabase/functions/send-reminders/index.ts` – serverseitiger Push-Versand
