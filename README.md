# Leonhards Familienkalender — Famkal 1.2.0

## Projektliste (1.2.0)

Im Profil (Avatar → **Projekt & offene Punkte**) stehen offene und abgeschlossene Punkte, Prioritäten, Versionen und die Änderungshistorie. Familienmitglieder haben ausschließlich Lesezugriff. Pflege erfolgt über den autorisierten Chat und die Supabase-Verbindung **RC Apple** zum bestehenden Projekt `fbjvlkgvsatnjrtoigvt`.

Die Tabellen `project_items`, `project_releases` und `project_item_history` sind durch RLS auf die eigene Familie beschränkt. Keine Schreibrechte für Browserrollen; keine neuen schreibenden RPCs. Trigger protokollieren Aufnahme und Änderungen automatisch mit alten/neuen Werten, Datenbankakteur, Quelle und Kommentar. Punkte und Historieneinträge werden nicht gelöscht. Die Historie schützt vor gewöhnlichem Überschreiben, ist aber gegenüber privilegierten Datenbankadministratoren nicht manipulationssicher.

### Pflege über den Chat

Vor Änderungen die aktuelle Liste aus Supabase lesen. Neue Wünsche nur sammeln, bis Umsetzung ausdrücklich beauftragt wird. Bestehende Nummern bleiben stabil; `change_source='chat'` und ein konkreter `change_note` gehören zu jeder Änderung. Status: `collected`, `planned`, `in_progress`, `implemented`, `verified`, `discarded`. Erledigte Punkte erhalten `completed_version`; Wiederöffnen entfernt diese Zuordnung. Versionen vor der Zuordnung anlegen. Bei neuen Punkten die Familie in einer Transaktion sperren (`SELECT ... FROM public.families WHERE id=... FOR UPDATE`), dann die nächste familienbezogene `item_no` bestimmen. Keine Anmeldedaten oder Familieninhalte in Projektbeschreibungen aufnehmen.

Die ersten sechs Punkte wurden aus dem Chat übernommen. Version 1.1.0 ist nachträglich dokumentiert; die Historie beginnt mit diesem Import. Die Migration `supabase/migrations/20261002055653_project_tracker_v120.sql` erweitert das vorhandene Backend additiv. Sie ersetzt keine Kalenderdatenbank. Nach Anwendung: `tests/project-security.sql` ausführen; Teständerungen werden zurückgerollt.

Bestehendes Projekt, bereinigt am 01.10.2026.

- Webseite: https://vbcoco.github.io/Famkal/
- Repository: VBCoCo/Famkal
- Supabase-Projekt: fbjvlkgvsatnjrtoigvt
- Für Arbeiten mit verbundenen Konten ausschließlich **RC Apple** verwenden.

## Nutzung

Mit E-Mail und Passwort anmelden. Bei neuen Konten ist die E-Mail-Bestätigung
erforderlich. Neue Familien können in der App angelegt werden. Einladungen sind
sieben Tage gültig und an die bestätigte E-Mail-Adresse gebunden.

Heute, Woche und Aufgaben unterstützen Schule, Betreuung, Bringen/Abholen,
allgemeine Termine und Bettgehzeit. Ganztägige Termine haben keine Uhrzeit.
Aufgaben zeigen die nächsten 120 Tage; weitere Einträge werden über
„Weitere Aufgaben anzeigen“ sichtbar. Wochen laden beim Blättern nach.

## Rollen und Berechtigungen

- **Owner:** Kalender und Mitglieder verwalten; Admin-/Owner-Rollen vergeben.
  Der letzte Owner kann nicht herabgestuft werden. Eine Übertragung erfolgt,
  indem zunächst ein anderer Owner ernannt wird.
- **Admin:** Kalender und Serien verwalten, Mitglieder einladen und Name/Farbe
  normaler Mitglieder bearbeiten. Keine Admin-/Owner-Rollen ändern.
- **Member:** Termine und Serien anlegen; eigene oder zugewiesene Termine
  bearbeiten, selbst angelegte Termine löschen. Bei Serien nur einzelne
  berechtigte Vorkommen bearbeiten oder eigene einzelne Vorkommen stornieren.

Alle Rollen können ihr eigenes Profil und vorbereitete Erinnerungseinstellungen
ändern. Direkte Änderungen an Rolle, Familien-ID, Benutzer-ID, Ersteller und
Serienzuordnung sind für App-Benutzer gesperrt. Zuständige Personen und Serien
müssen zur gleichen Familie gehören. RLS gilt auf allen Anwendungstabellen.

Privilegierte Funktionen liegen im nicht exponierten Schema private. Öffentliche
RPCs sind SECURITY INVOKER und delegieren an kontrollierte interne Funktionen.
Nicht angemeldete Benutzer haben weder Tabellen- noch RPC-Zugriff.

## Serien

Wiederholung: täglich, Mo–Fr, wöchentlich oder zweiwöchentlich. Ohne Enddatum wird
ein Jahr angelegt; höchstens zwei Jahre sind möglich. Vorkommen werden als
konkrete Termine gespeichert.

Einzelne Vorkommen können als Ausnahmen bearbeitet werden. Owner/Admins können
einen Termin und alle folgenden oder die gesamte Serie bearbeiten. Eine Änderung
des Datums verschiebt reguläre betroffene Vorkommen um den gleichen Tagesabstand.
Andere individuelle Ausnahmen bleiben unverändert. Ganztägig und Uhrzeiten werden
übernommen. Stornierte Vorkommen werden nicht wieder aktiviert.

Rhythmus und Enddatum bestehender Serien sind im Editor bewusst schreibgeschützt:
Es wird keine vermeintliche Änderung angeboten, die im Backend wirkungslos bleibt.
Um den Rhythmus zu ändern, alte Vorkommen stornieren und eine neue Serie anlegen.

## PWA / iPhone

In Safari öffnen → Teilen → Zum Home-Bildschirm. App-Icons und alle
JavaScript-Abhängigkeiten werden mitgeliefert. Ein Update-Hinweis aktiviert eine
bereitstehende neue Version; dabei werden offene Formulare geschlossen.

Offline ist nur die App-Oberfläche verfügbar. Login, Kalenderdaten und Schreiben
benötigen Internet. Persönliche Kalenderdaten werden nicht im Service-Worker-Cache
gespeichert. Bei Abmeldung werden angezeigte Familieninformationen geleert.

## Benachrichtigungen: noch nicht eingerichtet

Erinnerungsminuten (0 bis 10080, maximal zehn Angaben) und Benachrichtigungswünsche
werden gespeichert. **Es findet noch kein Push-, E-Mail- oder Hintergrundversand
statt.** Die Oberfläche weist darauf hin; sie meldet keine falsche Aktivierung.

Für einen späteren Ausbau fehlen noch VAPID-Schlüssel, eine abgesicherte
send-reminders-Edge-Function, ein Zeitplan und Zustelltests einschließlich iPhone.
Private VAPID-/Cron-Schlüssel und service_role dürfen nie ins Repository gelangen.

## Datenbank / Migration

Die bestehende Datenbank wurde über folgende gezielte Migration aktualisiert:

supabase/migrations/20261001175614_harden_famkal_v110.sql

Sie erhält vorhandene Daten. **Nicht erneut auf dem bereits migrierten Projekt
ausführen.** Weitere Änderungen benötigen eigene Migrationen.

supabase.txt ist nur das historische Einrichtungsskript der ursprünglichen
Version. Es enthält überholte Sicherheitsregeln und darf nicht zur Neuinstallation
oder als Reparatur auf der aktuellen Datenbank ausgeführt werden.

## Entwicklung und Prüfungen

Node.js 22+:

    npm ci
    npm run build
    npm test
    npm audit

GitHub Pages liefert die eingecheckten statischen Dateien direkt aus. Das
Supabase-Browserpaket ist fest versioniert und wird als vendor/supabase.js
gebündelt; es gibt keinen Laufzeitimport von einem fremden CDN.

tests/security.sql prüft Rollen, Familienisolierung, Einladung, Profil,
NULL-Berechtigungsprüfung, Serien/Ausnahmen und Datenvalidierung im SQL-Tool.
Die gesamte Prüfung läuft in einer Transaktion mit künstlichen Fixtures und
ROLLBACK. Keine echten Konten müssen hierfür angemeldet werden.

## Noch offene Plattformprüfung

Der Supabase-Sicherheitsberater meldet nach der Bereinigung weiterhin deaktivierten
Schutz vor kompromittierten Passwörtern. Dieser Dashboard-Schalter ist über die
vorhandene Verbindung nicht schreibbar; Tarifverfügbarkeit prüfen.

Auth Site URL und erlaubte Redirect URLs müssen auf die genaue Pages-Adresse
passen (inklusive /Famkal/; Passwort-Recovery nutzt ?recovery=1). Rate-Limits,
Passwort-Mindestlänge und CAPTCHA müssen im Dashboard überprüft werden. Die
Oberfläche verlangt für neue/ersetzte Passwörter zwölf Zeichen; das ersetzt nicht
die serverseitige Einstellung. Bestehende kürzere Passwörter werden beim Login
nicht ausgesperrt.

HTTPS ist aktiv. CSP wird als Meta-Tag gesetzt. GitHub Pages erlaubt keine freien
Security-Response-Header; frame-ancestors kann daher hier nicht per Meta-Tag
erzwungen werden. Eine andere Hostinglösung ist dafür später optional, nicht
Voraussetzung für diese Bereinigung.
