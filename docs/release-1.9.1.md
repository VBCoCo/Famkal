# Famkal 1.9.1

Freigegeben am 6. Oktober 2026: klarere Push-Texte und ein optionaler Text pro Erinnerung, gleich für alle Empfänger.

- Titel: Erinnerung; Inhalt: Termin · Uhrzeit Uhr, anschließend optionaler Text.
- Keine Zuständigkeits- oder Eigentümerlabels im Push-Text.
- Text je Vorlaufzeit, maximal 240 Zeichen; doppelte Vorlaufzeiten werden im Editor abgewiesen.
- Notizen in Termindetails sichtbar, sicher als Text ausgegeben.
- Serien-, Wochentags- und Einzeländerungen sowie Umwandlung eines Einzeltermins übernehmen die Texte.
- Alte Clients erhalten Texte für bestehende Vorlaufzeiten; entfernte Vorlaufzeiten entfernen ihren Text.
- Additive JSONB-Spalte, bestehende RPC-Rechte und RLS unverändert; Versand liest den aktuellen Text bei der Vorbereitung.
- iOS bestimmt weiterhin die Herkunftszeile „from …“.

Validierung: 101 automatisierte Tests einschließlich PostgreSQL-Regression; isolierte Produktionsprüfung für Speicherung, ungültige Texte, Serienübernahme, alte Clients, Push-Vorbereitung und Berechtigungen, vollständig zurückgerollt. Build erfolgreich. Browserlayout bei 320×700, 390×844 und 844×390 geprüft, kein horizontaler Überlauf, Textfelder 16 px. Edge Function Version 3 aktiv, unauthentifizierte Anfrage abgewiesen. Sicherheitsberater unverändert gegenüber vorherigem Stand.

Vorher/Nachher: 1.425 Termine, 20 Serien, fünf Personen, vier Kalender. MD5 der bestehenden Terminspalten: 369901726eeeb7ba7e1a38cd609928b2. Keine echten Test-Pushs, Einladungen oder Änderungen an bestehenden Terminen.

Ein neuer iPhone-Praxistest mit optionalem Text bleibt noch ausstehend.
