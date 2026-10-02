# Leonhards Familienkalender — Famkal 1.4.0

## Kalender und Aufgaben auf dem iPhone (1.4.0)

Heute und Woche teilen den Filter „Alle Termine / Für mich“. Der Filter bleibt
zusammen mit dem Kopfbereich beim Scrollen sichtbar; die Auswahl gilt beim
Ansichtswechsel weiter. Aufgaben verwenden dieselben Bezeichnungen und bieten
zusätzlich „Ungeklärt“. Diese Zusatzoption wirkt nur auf Aufgaben. Die Auswahl
wird beim Abmelden zurückgesetzt und startet mit allen Terminen.

Unter Heute erscheinen die kommenden Termine der nächsten 120 Tage, auch wenn
heute nichts eingetragen ist. Zunächst fünf, weitere in Schritten von zehn.
Die Terminkarten zeigen Uhrzeit, Art und Titel; im persönlichen Filter und in
Aufgaben auch die Tätigkeit. Details, Personen, Ort, Notizen und vorbereitete
Erinnerungen werden aufgeklappt. Bearbeiten/Ansehen ist davon getrennt; die
bisherigen Rechte und der Serieneditor gelten unverändert. Bei „Für mich“
entfällt der eigene Name, andere beteiligte Personen bleiben in Details sichtbar.

Die Personenfarbe umrandet die Karte und den breiteren linken Streifen. Bei
eigener Beteiligung hat die eigene Farbe Vorrang. „Zuständigkeit offen“ markiert
Termine ohne Zuordnung; bei Betreuung/Bettgehzeit fehlt der Zuständige, bei
Fahrten fehlen beide Fahrtzuordnungen. Eine Fahrt benötigt nicht zwangsläufig
Hin- und Rückweg. Eine teilweise zugeordnete allgemeine Veranstaltung gilt
nicht automatisch als ungeklärt, da keine Pflichtrollen im Datenmodell existieren.

Aufgaben berücksichtigen jetzt jede Terminart mit Bringt, Holt oder Zuständig,
einschließlich allgemeiner Termine und Schule. Ungeklärte Fahrten, Betreuung
und Bettgehzeit bleiben Aufgaben. Mehrere Rollen ergeben nur eine Karte mit
den Tätigkeiten. Das Plus sitzt innerhalb der unteren Navigationszeile.

Prüfung: 40 automatisierte Tests bestanden, einschließlich Filterwechsel,
zukünftiger Termine, Zuordnung, fehlender Zuständigkeit, Aufklappen/Bearbeiten,
HTML-Escaping und bestehender Auth-/Serienprüfungen. Keine Backend-, Schema-
oder Berechtigungsänderungen; Kalenderdaten unverändert.
Robert bestätigt für 1.3.1: Termine und Serien anlegen, einzelnen Serientermin
ändern und Eingang der Recovery-Mail funktionieren. Einladung, PWA und
vollständiger Recovery-Passwortwechsel sind noch nicht bestätigt.

## Recovery-Mail für den Owner (1.3.1)

Auf der Anmeldeseite E-Mail-Adresse eintragen und „Passwort vergessen?“ wählen.
Die Antwort verrät weder vorhandene Konten noch die Mailfreigabe: „Falls für
diese Adresse eine Wiederherstellung möglich ist, erhältst du eine E-Mail.
Falls du keine E-Mail erhältst, prüfe bitte deinen Spam-Ordner und wende dich
anschließend an deinen Familien-Administrator.“ Wiederholungen werden im
gleichen Browser für eine Minute gebremst; Supabase erzwingt seine Serverlimits.

Der Supabase-Standardversand funktioniert ohne eigenen SMTP nur für bestätigte
Mitglieder der Projektorganisation; die Adresse muss exakt der Famkal-Adresse
entsprechen. Der Owner ist inzwischen mit dieser Adresse beigetreten. Das
Projektkontingent beträgt derzeit zwei E-Mails je Stunde, ohne Zustellgarantie.
Famkal-Mitgliedschaft allein autorisiert keinen Mailversand. Persönliche
Admin-Reset-Links bleiben als Alternative verfügbar.

Supabase bestätigt den Mail-Link und leitet zur festen Famkal-Adresse mit einer
Recovery-Sitzung im URL-Fragment weiter (Implicit Flow). Famkal entfernt die
Tokens sofort aus der Adresszeile und übernimmt sie erst nach bewusstem Klick;
Supabase validiert die Sitzung über `setSession`. Danach erscheint der
Passwortdialog. Kein Familienbeitritt und keine Rollenänderung durch Recovery.
Abgelaufene Links und fehlerhafte Sitzungen werden abgefangen. Die bestehenden
manuell erzeugten Token-Hash-Links funktionieren weiterhin. Keine Tokens oder
Mailadressen im Projektlog speichern.

Prüfung am 02.10.2026: 31 Anwendungstests und 14 reale Auth-Prüfungen bestanden.
Die Mail-Anforderung für den Owner wurde von Supabase ohne Fehler akzeptiert.
Der tatsächliche Eingang und der Klick aus dessen Postfach müssen vom Owner
bestätigt werden; Postfachzugriff stand für diesen Test nicht zur Verfügung.

## Einladungsbasierte Konten ohne SMTP (1.3.0)

Keine öffentliche Registrierung. Owner/Admin erzeugen persönliche Einladungslinks, die sie selbst weitergeben. Der Link wird bewusst erst nach Klick eingelöst; dann setzt die eingeladene Person ihr Passwort und tritt der vorgesehenen Familie bei. Anmeldetoken liegen im URL-Fragment und werden beim Laden aus der Adresszeile entfernt. Sie werden nicht in Projektlog oder Datenbank gespeichert. Familienzuordnung prüft bestätigte Konto-E-Mail, Gültigkeit und Einmalverwendung.

`family-access` prüft die Sitzung über `getUser`, delegiert Familienrechte und Rate Limits an serverexklusive RPCs und ruft `auth.admin.generateLink` auf. Server-Schlüssel bleiben in der Edge Function. Reset nur für eigene Familienmitglieder; Admin kann außer dem eigenen Konto nur Member zurücksetzen; fremde Owner können auch durch Owner nicht zurückgesetzt werden. Ein Reset-Link ermöglicht Zugriff auf das Zielkonto und muss vertraulich persönlich übergeben werden. Bei Aussperrung des einzigen Owners: Wiederherstellung über das Supabase-Dashboard.

### Verbindliche Aktivierung vor Veröffentlichung

Die Vorbereitungsmigration `20261002070047_invite_only_auth_v130.sql` lässt `private.family_access_config.enabled=false`. Alte 1.2.0-Aufrufe bleiben bis zum Versionswechsel verfügbar. Vor Freigabe in **RC Apple**, Projekt `fbjvlkgvsatnjrtoigvt`, prüfen:

- Auth: **Allow new users to sign up = OFF** (serverseitig); anonyme Anmeldung OFF.
- E-Mail-Passwort: Mindestlänge 12, OTP-/Einladungs-/Recovery-Gültigkeit höchstens 3600 Sekunden; E-Mail-Bestätigung bleibt aktiv. Leaked Password Protection bleibt im Free-Tarif nicht verfügbar.
- Site URL und erlaubte Produktionsweiterleitungen auf `https://vbcoco.github.io/Famkal/` begrenzen; benötigte Varianten explizit zulassen.
- Edge Function `family-access` deployen: `verify_jwt=false`, weil die Funktion jeden Bearer-Token selbst serverseitig über `getUser` prüft. Ohne gültige Sitzung niemals Zugriff.
- `tests/invite-security.sql` und die bisherigen SQL-Tests ausführen; synthetische Daten werden zurückgerollt. Auth-End-to-End-Test mit einem eigens dafür angelegten Konto durchführen; bestehende Konten und Passwörter nicht verändern.
- Die Aktivierungsmigration `20261002071717_activate_invite_only_auth_v130.sql` ist absichtlich gesperrt. Erst nach bestätigten Auth-Einstellungen und End-to-End-Prüfung in derselben Migrationstransaktion `select set_config('famkal.auth_config_verified','yes',true);` voranstellen. Sie aktiviert Link-Freigabe und sperrt die alten `create_family`-/`create_family_invitation`-RPCs für `authenticated`. Mit Veröffentlichung der Oberfläche abstimmen. Bei Fehlern Freigabe deaktivieren; keine bestehenden Konten löschen.

Die Einladungslinks senden keine E-Mail. Seit 1.3.1 kann „Passwort vergessen“ eine Recovery-Mail anfordern. Ohne eigenen SMTP sind nur Organisationsmitglieder für diesen Versand zugelassen. Für andere Familienadressen bleiben die persönlichen Admin-Reset-Links erforderlich.

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

Mit E-Mail und Passwort anmelden. Neue Konten entstehen ausschließlich durch
persönliche Einladungslinks eines Owners/Admins. Unter Familie wird der Link
erzeugt und anschließend persönlich weitergegeben. Er gilt höchstens eine Stunde
und ist nur einmal einlösbar. Die eingeladene Person setzt ein Passwort mit
mindestens zwölf Zeichen, Buchstaben und Ziffern. Neue Familien können nicht
öffentlich angelegt werden; bestehende Familien bleiben erhalten.

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

`tests/invite-security.sql` prüft zusätzlich serverexklusive Link-RPCs,
Rollenwechsel, Familiengrenzen, Rate Limits und Wiederverwendung. Der reale
Auth-Test `tests/auth-e2e.mjs` verwendet isolierte temporäre Konten und den
vorhandenen Endpunkt; keine zusätzlichen privilegierten Test-Endpunkte und kein
SMTP. Fixture-Dateien mit Testpasswörtern niemals einchecken. Nach dem Test nur
die eigens erzeugten Familien, Link-Anfragen und Konten gezielt entfernen.

Am 02.10.2026 bestanden: 26 Unit-Tests, SQL-Berechtigungsprüfungen vor/nach
simulierter Aktivierung und 13 reale Auth-Prüfungen (Registrierung gesperrt,
Einladung, Passwortstärke, Familienbeitritt, Einmalverwendung, Anmeldung,
Member-Ablehnung und Recovery einschließlich Ablehnung des alten Passworts).

## Plattformprüfung und verbleibende Grenzen

Der Supabase-Sicherheitsberater meldet nach der Bereinigung weiterhin deaktivierten
Schutz vor kompromittierten Passwörtern. Er ist nur ab Pro verfügbar und bleibt
wegen des gewünschten Free-Tarifs offen. Mindestlänge und Zeichenregeln bieten
keinen gleichwertigen Schutz gegen bereits kompromittierte Passwörter.

Dashboard am 02.10.2026 geprüft: öffentliche/anonyme Registrierung aus,
E-Mail-Bestätigung und sichere E-Mail-/Passwortänderung aktiv, Mindestlänge 12,
Buchstaben und Ziffern erforderlich, OTP-Gültigkeit 3600 Sekunden. Site URL und
einzige Redirect URL: `https://vbcoco.github.io/Famkal/`. Persönliche Admin-Links
nutzen eigene URL-Fragmente; Recovery-Mails den Standard-Implicit-Flow. Die Serverprüfung der Passwortlänge ist durch den
realen Auth-Test bestätigt. Bestehende kürzere Passwörter werden beim Login nicht
ausgesperrt. Projektinterne Link-Limits: höchstens ein Link je Familie/Minute und
zehn je Stunde; plattformweite Auth-Limits bleiben zusätzliche Grenzen.

HTTPS ist aktiv. CSP wird als Meta-Tag gesetzt. GitHub Pages erlaubt keine freien
Security-Response-Header; frame-ancestors kann daher hier nicht per Meta-Tag
erzwungen werden. Eine andere Hostinglösung ist dafür später optional, nicht
Voraussetzung für diese Bereinigung.
