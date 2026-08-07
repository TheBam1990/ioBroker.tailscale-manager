# ioBroker.tailscale-manager

[English](README.md)

Installiert, überwacht und steuert den Tailscale-Client auf demselben Rechner,
auf dem diese ioBroker-Adapterinstanz läuft. Der Adapter bietet dauerhafte und
zeitlich begrenzte Verbindungen, Statusdaten, Auth-Key-Einrichtung sowie die
offizielle Browseranmeldung über Identitätsanbieter wie GitHub oder Google.

> Dieses Projekt ist ein unabhängiger ioBroker-Adapter und steht in keiner
> Verbindung zu Tailscale Inc. und wird nicht von Tailscale Inc. unterstützt.

## Voraussetzungen

- ioBroker js-controller ab 6.0.11
- ioBroker Admin ab 7.6.20
- Node.js ab Version 20
- Administratorrechte für die einmalige Tailscale-Systeminstallation
- Linux: `/dev/net/tun` muss verfügbar sein

Die automatische Installation verwendet unter Linux das offizielle
Tailscale-Installationsskript, unter Windows `winget` und unter macOS Homebrew.
Sie funktioniert nur, wenn der ioBroker-Prozess die notwendigen Systemrechte
besitzt. Der Adapter verändert niemals sudoers und erteilt sich keine
Administratorrechte.

## Anmeldeverfahren

### Methode A: Tailscale Auth-Key

Diese Methode eignet sich besonders für einen ioBroker-Server ohne Bildschirm.

1. In der Tailscale-Administrationskonsole die Seite **Keys** öffnen.
2. **Generate auth key** auswählen.
3. Key konfigurieren. Für einen dauerhaften Server ist `Pre-approved` sinnvoll;
   ein einmaliger Key ist sicherer, sofern keine Wiederverwendung nötig ist.
4. Den Key in der Adapterkonfiguration unter **Tailscale Auth-Key** eintragen.
5. Optional einen Hostnamen wie `iobroker-203` festlegen.
6. Einstellungen speichern und `control.connected` auf `true` setzen.

Der Auth-Key wird in ioBroker verschlüsselt und geschützt gespeichert und nie
als Datenpunkt ausgegeben. Beim Verbindungsaufbau schreibt der Adapter ihn in
eine temporäre, nur für den Besitzer lesbare Datei, übergibt Tailscale lediglich
eine `file:`-Referenz und entfernt die Datei sofort wieder. Fehlermeldungen
werden zusätzlich auf Schlüssel geprüft und geschwärzt.

### Methode B: GitHub, Google oder anderer Browseranbieter

Der Adapter fragt niemals GitHub- oder Google-Zugangsdaten ab. Die Anmeldung
findet direkt auf der offiziellen Tailscale-Seite im Browser statt.

1. Ist das Gerät bereits angemeldet und soll die Identität gewechselt werden,
   einmal `control.logout` auslösen. Das meldet nur dieses Gerät lokal von
   Tailscale ab und löscht kein GitHub- oder Google-Konto.
2. Einmal `control.loginInteractive` auslösen.
3. Warten, bis `info.loginUrl` eine Adresse mit
   `https://login.tailscale.com/...` enthält.
4. Diese Adresse im Browser öffnen.
5. Den für das Tailnet angebotenen Anbieter auswählen, zum Beispiel GitHub oder
   Google, und dessen Anmeldung abschließen.
6. `info.connection` kontrollieren. Nach erfolgreicher Anmeldung wird der Wert
   `true`.

Welche Anbieter angeboten werden, hängt von der Identitätskonfiguration des
Tailnets ab. Der Adapter kann keinen Anbieter freischalten und kein bestehendes
Tailscale-Konto in einen anderen Anbieter umwandeln.

## Dauerhafte Verbindung

`control.connected` auf `true` oder `false` setzen. Der Steuerdatenpunkt wird
nach jeder Statusabfrage mit `ack=true` auf den bestätigten Istzustand gesetzt.
`info.connection` ist zusätzlich der ausschließlich lesbare Verbindungsstatus.

## Zeitlich begrenzte Verbindung

1. In `control.durationMinutes` eine Dauer zwischen 1 und 10080 Minuten setzen.
2. Einmal den Taster `control.enableTimed` auslösen.
3. Tailscale verbindet sich sofort und trennt sich beim Erreichen der Endzeit.

Die Admin-Einstellung **Standarddauer für zeitweilige Verbindung** setzt den
Anfangswert von `control.durationMinutes` nach einem Adapterstart.
`info.remainingSeconds` und `info.remainingTime` zählen im Sekundentakt
herunter. `info.enabledUntil` speichert die Endzeit, sodass ein Adapterneustart
die automatische Abschaltung nicht verliert.

## Datenpunkte

| Datenpunkt | Zugriff | Bedeutung |
|---|---|---|
| `control.connected` | lesen/schreiben | Dauerhaft ein-/ausschalten mit bestätigter Rückmeldung |
| `control.durationMinutes` | lesen/schreiben | Laufzeit der zeitweiligen Verbindung in Minuten |
| `control.enableTimed` | Taster | Jetzt verbinden und nach der gewählten Zeit trennen |
| `control.install` | Taster | Tailscale-Installation versuchen |
| `control.loginInteractive` | Taster | Offizielle Browseranmeldung starten |
| `control.logout` | Taster | Dieses Gerät lokal von Tailscale abmelden |
| `control.refresh` | Taster | Status sofort aktualisieren |
| `info.connection` | lesen | Tatsächlicher Verbindungsstatus |
| `info.installed` | lesen | Tailscale-Programm installiert |
| `info.serviceRunning` | lesen | Lokaler Tailscale-Dienst antwortet |
| `info.tunAvailable` | lesen | Linux-TUN-Gerät vorhanden |
| `info.backendState` | lesen | Backendzustand, z. B. `Running` oder `NeedsLogin` |
| `info.loginUrl` | lesen | Offizielle interaktive Anmeldeadresse |
| `info.tailscaleIPs` | lesen | Zugewiesene IPv4- und IPv6-Adressen |
| `info.dnsName` | lesen | MagicDNS-Name |
| `info.tailnet` | lesen | Name des Tailnets |
| `info.peersOnline` | lesen | Anzahl erreichbarer Teilnehmer |
| `info.enabledUntil` | lesen | Endzeit der zeitweiligen Verbindung |
| `info.remainingSeconds` | lesen | Verbleibende Laufzeit in Sekunden |
| `info.remainingTime` | lesen | Lesbare Restzeit (`HH:MM:SS`) |
| `info.lastError` | lesen | Letzter Adapter- oder Befehlsfehler |

## Proxmox-LXC

Tailscale benötigt für den normalen Kernel-Netzwerkbetrieb `/dev/net/tun`. Das
Gerät muss auf dem Proxmox-Host an den Container durchgereicht werden:

```sh
pct set <CTID> --dev0 path=/dev/net/tun
pct reboot <CTID>
```

Nach dem Neustart im Container prüfen, ob `/dev/net/tun` existiert. Diese
Berechtigung gehört zur Proxmox-Hostkonfiguration und kann nicht durch einen im
Container laufenden Adapter vergeben werden. Der Adapter meldet den Zustand in
`info.tunAvailable` und gibt unter `info.setupHint` einen Hinweis aus.

## Sicherheitshinweise

- Möglichst begrenzte, einmalige oder vorab genehmigte Auth-Keys verwenden.
- Einen versehentlich veröffentlichten Key sofort widerrufen.
- Tailscale-Grants beziehungsweise ACLs nach dem Minimalprinzip konfigurieren.
- `control.logout` in Visualisierungen und Skripten gegen unbeabsichtigtes
  Auslösen schützen.
- Das Aktivieren von Tailscale verändert die Netzwerkerreichbarkeit des Hosts.

## Änderungsverlauf

### 0.0.1 (2026-08-07)

- Erste Testversion mit Installation, verschlüsselter Auth-Key-Verarbeitung,
  interaktiver Browseranmeldung, dauerhafter und zeitlicher Steuerung,
  TUN-Diagnose und Verbindungsstatus.

## Lizenz

MIT-Lizenz
