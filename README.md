# Leonhards Familienkalender — Famkal 1.9.1

## Klarere Push-Erinnerungen und optionale Texte (1.9.1)

Benachrichtigungen zeigen „Erinnerung“, Termin und Uhrzeit ohne zusätzliche Zuständigkeitslabels. Jede Vorlaufzeit kann einen optionalen Text mit bis zu 240 Zeichen erhalten, der allen Empfängern dieser Erinnerung angezeigt wird. Texte bleiben bei Einzel-, Serien- und Wochentagsänderungen sowie beim Umwandeln in eine Serie erhalten. Entfernte Erinnerungen entfernen ihren Text; bestehende Termine und Vorlaufzeiten bleiben unverändert. Die zusätzliche Herkunftszeile „from …“ wird weiterhin durch iOS bestimmt.

## Gezieltes Nachladen und Serienänderungen (1.9.0)

Heute und Aufgaben sind auf heute bis 30 Tage voraus begrenzt. Fehlende Kalendertage/-wochen werden zusätzlich geladen; vorher geladene Zeiträume werden kontolokal im Arbeitsspeicher wiederverwendet. Verwaltungsdaten werden beim Blättern nicht erneut geladen. Manuelles Aktualisieren und jede eigene Änderung invalidieren den Cache; nach fünf Minuten wird er ebenfalls erneuert. Keine Offline-Speicherung. Bei schwacher Verbindung begrenzte Wartezeit, vorhandene Ansicht bleibt erhalten; Sitzungsfehler werden einmal mit erneuerter Anmeldung versucht, fehlende Sitzungen führen zum Login. Keine Erweiterung der anonymen Leserechte.

Owner können beim Speichern einer Serie Wochentage auswählen und ab dem geöffneten Termin ändern. Abgesagte Termine und andere individuelle Ausnahmen bleiben erhalten. Datum/Zeit und Zuständigkeit folgen der vorhandenen Bearbeitungslogik. Wiederholte Wochentagsänderungen bleiben möglich. Die Wiederholungsregel bestehender Serien bleibt schreibgeschützt.

Ein bearbeitbarer Einzeltermin kann durch Wahl einer Wiederholung in eine Serie umgewandelt werden. Die bestehende ID und der Ersteller bleiben erhalten; zusätzliche Termine bekommen eigene IDs. Der Ausgangstermin muss bei Mo–Fr oder freier Wochentagswahl auf einen passenden Tag fallen. Datum, Zeiten, Kalender, Zuständigkeit und Erinnerungen werden übernommen. Urlaub bleibt ein Einzeltermin. Maximal zwei Jahre Serienlaufzeit; ungültige Eingaben und veraltete Bearbeitungsstände rollen vollständig zurück.

## Wochenkalender und Schwimmen (1.8.0)

„Woche“ zeigt genau einen separat gewählten Kalender als Zeitraster mit sieben Tagesspalten (Montag–Sonntag), Ganztagszeile und Überlappungen. Die Auswahl wird pro Konto gespeichert und verändert nicht die eingeblendeten Kalender anderer Ansichten. Terminantippen öffnet die bestehende kompakte Übersicht. Sieben Spalten teilen auch am iPhone die verfügbare Breite; Texte werden dort verkürzt. Keine Einträge bedeuten weiterhin keine bestätigte Verfügbarkeit.

Die neue Terminart „Schwimmen“ (swimming, 🏊) unterstützt die bestehenden Zuständigkeiten, Serien und Erinnerungen. Vorhandene Termine werden nicht umbenannt oder umkategorisiert. Die Migration erweitert ausschließlich die erlaubten Terminarten; sie verändert keine Bestandsdaten.

## Echte Push-Erinnerungen (1.6.0)

Unter Mehr → Benachrichtigungen werden Anleitung, Status dieses Geräts,
Aktivierung, Testnachricht und Deaktivierung angezeigt. Auf dem iPhone Famkal
zuerst zum Home-Bildschirm hinzufügen, dann über das Symbol öffnen und anmelden.
„Push-Erinnerungen aktivieren“ antippen und die iPhone-Abfrage mit „Erlauben“
bestätigen. Jede Person aktiviert jedes eigene Gerät selbst; ChatGPT ist dafür
nicht nötig. Nach Ablehnung sind die iPhone-Mitteilungseinstellungen zuständig.

Supabase Cron ruft `send-reminders` jede Minute über pg_net auf. VAPID- und
Cron-Zugangsdaten liegen verschlüsselt in Vault. Der Worker verwendet eine
serverseitig geprüfte Cron-Berechtigung oder bei Testnachrichten Supabase Auth
plus eigene Gerätezuordnung und ein Testlimit von einer Minute. Direkte
Geräteänderungen aus dem Browser sind gesperrt; registrieren/deaktivieren sind
geprüfte RPCs. Nur zugelassene Push-Provider erhalten HTTPS-Anfragen, ohne
Weiterleitungen. Geräteendpunkte und Schlüssel werden weder geloggt noch
anderen Familienmitgliedern angezeigt. Bis zu zehn aktive Geräte je Person.

Empfänger sind verknüpfte Zuständige und, außer bei Bettgehzeit, Inhaber des jeweiligen Kalenders. Bei Alle gilt die explizite Verantwortungsgruppe. Mehrere Zuordnungen ergeben je Gerät und Vorlauf nur eine
Nachricht. Testmitglieder erhalten keine Nachrichten. Alle Serienvorkommen sind
normale Termine; Absagen, veränderte Uhrzeiten/Vorläufe und entfernte Mitglieder
werden vor dem Versand erneut geprüft. Deutsche Zeit inklusive Sommerzeit;
ganztägige Termine haben als Erinnerungsbezug 09:00 Uhr. Termine ohne Uhrzeit,
ohne zuständige Person oder ohne eingestellte Vorläufe erzeugen keinen Versand.

Die Warteschlange verwendet eindeutige Versandaufträge und Claim-Leases mit
höchstens drei Versuchen. Bereits erfolgreiche Sendungen werden nicht wiederholt;
404/410 deaktiviert abgelaufene Geräte. Vorläufe werden höchstens zehn Minuten
nachgeholt und nicht später als fünf Minuten nach Terminbeginn. Push-TTL ist
entsprechend begrenzt. iOS, Fokus, Internet und Push-Provider bestimmen die
Anzeige; die Annahme durch den Provider beweist noch keine Geräte-Zustellung.
Bei einem Prozessabbruch zwischen Provider-Annahme und Datenbankbestätigung
kann ein Wiederholungsversuch nötig werden; ein stabiler Notification-Tag/Topic
fasst diese Nachricht am Gerät zusammen. Es wird keine absolute Exactly-once-
Zustellung versprochen. Aufbewahrung der Versandhistorie: 30 Tage.

Abmelden deaktiviert die aktuelle Geräteanmeldung und meldet sie beim Browser
ab, soweit der Backend-Aufruf gelingt. Andere Geräte bleiben angemeldet.
Bei Netzwerkfehlern bitte vor gemeinsam genutzten Geräten „Auf diesem Gerät
deaktivieren“ erfolgreich ausführen. Das Antippen einer Erinnerung öffnet den
betreffenden Termin nach Anmeldung und Prüfung der Familienzugehörigkeit.

Erste Version sendet ausschließlich Terminerinnerungen. Neue Zuordnungen und
Änderungsmitteilungen sind weiterhin als vorbereitet gekennzeichnet.
Apple-Kalender-Abo/Widget und senkrechter Farbverlauf bleiben spätere Punkte.
Die echte iPhone-Zustellung muss Robert nach Aktivierung selbst bestätigen.

## Personenfarben korrigiert (1.5.1)

Die Terminkarten haben eine einzige Basisregel für Rahmen, Fläche und Farbe.
Der transparente Rahmen zeigt wieder Personenfarben und Farbverläufe; abgesagte
Termine behalten ihre graue Innenfläche. Keine Änderungen an Kalenderdaten oder
Berechtigungen.

## Zuständigkeiten, Zeiträume und Urlaub (1.5.0)

Zuständig erlaubt mehrere Familienmitglieder oder Alle. Alle gilt dynamisch für
die aktuell aktiven echten und Testmitglieder. Bringt/Holt bleiben je eine
Auswahl. Mehrere Personen werden mit einem Verlauf ihrer Farben dargestellt.
Heute, Woche und Aufgaben teilen überall Alle, Meine, Ungeklärt, Abgesagt.
Absagen sind wiederherstellbar und bleiben normalerweise ausgeblendet.

Das pinke Testmitglied Test besitzt weder Auth-Konto noch Login, Mail oder
Berechtigungen. Es dient nur Farben/Zuordnungen. Verwaltung unter Admin;
Entfernen löst nur seine Zuordnungen und archiviert es, alle Termine und andere
Zuständige bleiben erhalten. Die bisherigen Login-Mitglieder bleiben unverändert.

Termine haben getrennte Start-/Enddaten. Ganztägige Enddaten sind einschließlich
des letzten Tages. Zeitgebundene Intervalle enden zur angegebenen Uhrzeit;
Ende 00:00 liegt an der Grenze zum Folgetag. Bettgehzeit schlägt 20:00 bis zum
folgenden Morgen um 06:00 vor. Jeder betroffene Tag zeigt den Termin, auch wenn
sein Beginn vor dem geladenen Zeitraum liegt. Neue Serien erlauben frei
ausgewählte Wochentage: z.B. So–Do und separat Fr/Sa. Serienende begrenzt den
Beginn des letzten Vorkommens, nicht dessen Ende am nächsten Morgen.
Die Regel bestehender Serien bleibt gesonderter offener Punkt 5.

Urlaub (Owner/Admin): Zeitraum eintragen, Nächster Schritt, überlappende aktive
Termine prüfen. Standardmäßig ist nichts ausgewählt. Gruppen nach Serie,
Auswahl einzelner oder aller angebotenen Vorkommen, dann Zusammenfassung und
explizites Speichern mit Absagen. Urlaub plus Auswahl werden atomar gespeichert.
Zeitlich fremde, schon abgesagte oder seit der Vorschau geänderte Ereignisse
werden serverseitig abgewiesen; nichts davon wird dann gespeichert.
Keine harte Löschung. Urlaubsabsagen rückgängig stellt nur Absagen dieses
Urlaubs wieder her. Eine manuell erneut bestätigte Absage löst ihren Urlaubsbezug
und bleibt beim Rückgängigmachen bestehen. Die Änderung eines bestehenden
Urlaubszeitraums verschiebt dessen früher bestätigte Absagen nicht automatisch.
Fehler erscheinen direkt im geöffneten Dialog, Eingaben bleiben erhalten.

Datenmodell: additive test_members/event_assignments, Enddatum/Alle/Urlaubsbezug
auf events, Wochentage auf event_series. Legacy-Zuordnungen bleiben erhalten und
werden über Trigger gespiegelt. Neue Tabellen sind familienbezogen per RLS
lesbar, Browser-Schreibzugriff ausschließlich über geprüfte RPCs. Eigene
Familie und aktive Personen werden serverseitig geprüft; ganze Serien und
Urlaubsaktionen bleiben Admin/Owner. Neue Felder haben keine direkten Schreib-
Grants für den Browser. Private SECURITY DEFINER-Implementierungen und öffentliche
SECURITY INVOKER-Wrapper, keine Auth- oder Registrierungsänderung.

Freigabe der größeren Datenbankerweiterung durch Robert am 02.10.2026.
48 Anwendungstests, zurückgerollte SQL-Funktions-/Berechtigungstests und zehn
reale API-Prüfungen erfolgreich. Die temporäre API-Testfamilie/-Identität wurde
vollständig entfernt. 90 Bestandsereignisse mit identischem Fingerprint und
95 unveränderte Legacy-Zuordnungen; ein echtes Konto plus Test ohne Anmeldung.
Supabase-Security-Advisors: keine neuen Warnungen, bekannter Passwortschutz ab
Pro bleibt offen; fehlende Policies auf zwei privaten, nicht browserbeschreibbaren
Access-Tabellen bedeuten dort absichtlichen Standard-Deny. Neue FK-Indizes
ergänzt. Angemeldete iPhone-Ansichten anschließend praktisch prüfen.

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

Push-Versand ist ab 1.6.0 eingerichtet. Die VAPID- und Cron-Schlüssel liegen
verschlüsselt in Supabase Vault; nur der öffentliche Schlüssel steht in config.js.
Private Schlüssel und service_role dürfen niemals ins Repository gelangen.

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

## Version 1.7.0 – persönliche Familienkalender

Vier verwaltete Startkalender: Leo, Robert, Anna, Oma Lena. Die Migration ordnet
alle vorhandenen Termine und Serien Leo zu und erhält ihre IDs, Inhalte,
Zeiten, Aufgabenverknüpfungen und Geräte. Dauerhafte `family_people`-Profile
sind unabhängig vom Login. `calendars`, `event_calendars` und `series_calendars`
trennen Kalenderzugehörigkeit von Bringt/Holt/Zuständig. Persönliche Einladungslinks
binden das bestätigte Konto atomar an das vorhandene Profil; keine automatische
Einladungs-Mail. Owner verwaltet Kalender, Namen, Reihenfolge und Archivierung.

Familienmitglieder dürfen im eigenen Kalender und bei Leo anlegen. Bei Leo
bearbeiten/absagen sie ihre selbst erstellten Einträge; bei eigenen Kalendern
ihre persönlichen Termine. Gemeinsame Termine erfordern Rechte für sämtliche
betroffenen Kalender. Aufgabe allein gibt keine Bearbeitungsrechte. Eine
separate Selbstzuordnung verändert nur die eigene Aufgabe. Serienoperationen
bleiben Owner-Aufgaben; einzelne Termine sind nach den Kalenderrechten editierbar.

`include_in_all_tasks` definiert die separat verwaltete Alle-Gruppe. Anfangs nur
bisherige Mitglieder und Testmitglieder. Neue Kalender/Logins erweitern diese
Gruppe nicht automatisch. Kalenderinhaber erhalten eigene Terminerinnerungen
auch ohne Aufgabenrolle, sofern sie ein Gerät aktiviert haben. Kein doppelter
Versand bei mehreren Rollen. Neue Zuordnungs-/Änderungsmitteilungen bleiben offen.

Familie zeigt eine Tageszeitachse mit Personenspalten, Übernacht-Clipping,
nebeneinander dargestellten Überschneidungen und horizontaler Verschiebung auf
kleinen Geräten. Kalenderauswahl wird pro Konto auf dem Gerät gespeichert.
Leere Zeit bedeutet keinen Eintrag, nicht bestätigte Verfügbarkeit. Hinweise
können `blocks_time=false` nutzen. Zeitgebundene Termine benötigen Start und Ende
mit mindestens einer Minute Dauer. Ganztägige Enddaten bleiben inklusiv.

Tests: `npm test`, einschließlich reproduzierbarer PostgreSQL-17-Prüfung mit
PGlite und synthetischen Konten. Lokale Stubs ersetzen ausschließlich Supabase-
Auth-/Vault-Infrastruktur und Extension-Installation. Prod-Prüfung mit isolierten
Fixtures in BEGIN/ROLLBACK; keine echten Geräte oder Einladungen ansprechen.
Alte Mutations-RPCs und direkte Spalten-Schreibrechte sind geschlossen.
PWA aktualisieren, falls die alte App zum Neuladen auffordert.

Rücknahme: vor COMMIT Transaktion abbrechen. Nach Nutzung persönlicher Kalender
keine pauschale Wiederherstellung des alten Datenbestands und kein ungefilterter
Rücksprung auf die 1.6-Ansicht. Neue Einträge sichern und vorzugsweise eine
Vorwärtskorrektur bereitstellen. Backups enthalten Familieninhalte und gehören
nicht ins öffentliche Repository. Kostenloses Supabase-Projekt unverändert.

## Kompakte Familienübersicht (1.7.1)

Gemeinsame Kopfzeile mit kleinem Ansichtstitel, Kalenderauswahl und Profil; flache Filter. Version nur im Profil und unter Mehr. Familienansicht verteilt die verfügbare Breite auf die ausgewählten Kalender, mit schmaler Zeitspalte, kompakter Datumsnavigation und Verfügbarkeitshinweis mit Erklärung. Terminsymbole einschließlich Bettgehzeit bleiben bei schmalen Spalten sichtbar; Details per Antippen. Ganztagszeile nur bei vorhandenen Terminen. Keine Änderung der Kalenderdaten oder Berechtigungen.

## Querformat und kompakte Termindetails (1.7.2)

Querformat erkennt die Oberfläche automatisch: Kopfzeile und Filter in einer Zeile, flache Datumsnavigation und untere Navigation. iPhone-Sicherheitsränder für Dynamic Island werden in allen Ansichten und Dialogen berücksichtigt. Spaltenberechnung verwendet tatsächliche Terminzeiten ohne künstliche Mindestüberschneidung. Kurze Termine behalten ihre Zeitfläche. Antippen in der Familienübersicht öffnet kompakte Angaben; Bearbeiten öffnet erst danach das Formular. Lange Notizen aufklappbar. Daten und Berechtigungen unverändert.

## Speichern und Zoom (1.7.3)

Gemeinsame Kalenderprüfung behandelt NEW.id und OLD.event_id in getrennten Triggerzweigen. Termin-/Serienänderungen schließen wieder erfolgreich ab; Pflicht-Kalenderzuordnung bleibt geschützt. Regression prüft echte COMMITs für Einzeltermin, folgende Termine und gesamte Serie sowie Ablehnung fehlender Kalender. Produktive isolierte Prüfung erzwingt verzögerte Constraints vor ROLLBACK. Touch-action manipulation verhindert Doppeltipp-Zoom und erhält Zwei-Finger-Zoom; Eingabefelder mindestens 16px gegen iPhone-Fokus-Zoom.

## Zuständigkeitskalender und kompakte Zeitfelder (1.7.4)

Termine erscheinen automatisch in den Kalendern der Personen für Bringt, Holt oder Zuständig; Alle verwendet die explizite Verantwortungsgruppe. Anzeige aus bestehenden Aufgaben abgeleitet, keine Kopien oder neuen Kalenderverknüpfungen. Kalenderauswahl wirkt auch auf automatische Einträge; Bearbeitungsrechte unverändert. Beginn und Ende jeweils mit Datum und Uhrzeit in einer Zeile, auch mobil; ganztägig ohne Uhrzeitfelder.

## Alle-Auswahl und Bettgehzeit (1.7.5)

Einzelpersonen bleiben bei Alle antippbar; Auswählen einer Person deaktiviert Alle automatisch, Alle deaktiviert Einzelpersonen. Bettgehzeiten erscheinen ausschließlich in Leos Kalender, auch bei vorhandenen zusätzlichen Kalenderverknüpfungen. Aufgaben und Erinnerungen der Zuständigen bleiben erhalten. Hinweis im Zuständigkeitsfeld. Erinnerungs-Empfänger folgen bei Bettgehzeit ausschließlich Aufgaben/Verantwortungsgruppe; reine Kalenderzugehörigkeit erzeugt keinen zusätzlichen Empfänger.

### Änderung in 1.7.6

Die Zusatzfelder Bringt/Holt und ihre Aufgaben-, Farb-, Kalender- und Erinnerungslogik entfallen vollständig. Alte Zuordnungen und Datenbankspalten werden ausdrücklich gelöscht; eigenständige Fahrten bleiben Termine mit normaler Zuständigkeit.

## Einladungsabschluss (1.7.7)

Die Kalenderprüfung beim Abschluss eines Einladungslinks verwendet eindeutige Tabellenaliase für ID, Familie, Ablauf und Verwendung. Regressionstest reproduziert den ursprünglichen Fehler und prüft danach den vollständigen Prepare/Finish/Join-Ablauf sowie Zielkonto, Ablauf, Archivierung, Wiederverwendung, Rechte und Recovery. Bestehende Konten und Einladungen bleiben erhalten.

## Farbauswahl auf dem iPhone (1.7.8)

Profil, Mitglieder, Testmitglieder und Kalenderverwaltung zeigen neben dem nativen Farbwähler eine unabhängige Farbvorschau und den Hex-Wert. Vorschau reagiert auf Input und Change; feste Höhe und Swatch-Regeln verhindern das Abschneiden durch allgemeines Input-Padding. Bestehende Speicherwege und Datenbank bleiben unverändert.

## Mobile Bedienung und Einladung (1.7.9)

Einladungen/Recovery haben eine eigene Ansicht ohne normale Anmeldung, mit klarer Aktion, Passwortanleitung und dauerhafter Fehlermeldung. Ein einzelner nativer Farbwähler ohne zusätzliche Vorschau/Hex-Wert. Familien-Terminkarten zeigen auch oben/unten 3-Pixel-Farbrahmen bei unveränderter Zeitposition und vertikalem Verlauf. Bearbeitungsmaske mit kompakten Kalender-/Zuständigkeits-Chips, kurzer Alle-Beschriftung samt Info, zusammengefasstem Kalenderhinweis und kleinerem Notizfeld. Datenmodell und Berechtigungen unverändert.
