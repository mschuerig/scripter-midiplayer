# Beispiele

*[English](README.md)*

Fertige Beispiele für den [MIDI-Player](../README.de.md). Fang hier an, um den
Player auszuprobieren, ohne vorher einen eigenen Groove einzubacken.

## `example-player.js`

Ein fertiges, direkt einfügbares Player-Script. Es bündelt vier umschaltbare
Grooves – `Drummer-4-4`, `Drummer-3-4`, `Drummer-6-8` und `Drummer-7-8` –, sodass
du das Umschalten der Parts sofort hörst. Kopiere es in die Zwischenablage und
füge es in Scripter ein (siehe [Einen Player
vorbereiten](../README.de.md#einen-player-vorbereiten) im obersten README):

```sh
pbcopy < example-player.js
```

Er wurde aus den vier Quell-Grooves in diesem Ordner eingebacken –
`Drummer-4-4.mid`, `Drummer-3-4.mid`, `Drummer-6-8.mid` und `Drummer-7-8.mid`
(aus Logics Drummer exportiert) –, sodass du ihn neu backen oder anpassen kannst:

```sh
bun run ../midi2scripter.js to-script \
  Drummer-4-4.mid Drummer-3-4.mid Drummer-6-8.mid Drummer-7-8.mid | pbcopy
```

## `Drums-Example.concert`

Ein MainStage-Concert, das den Player von A bis Z verkabelt, damit du siehst, wie
er von einem Controller aus gesteuert werden soll. Doppelklicke es, um es in
MainStage zu öffnen.

Es führt eine Kopie von `example-player.js` mit **aktiviertem `TRACE`** aus,
sodass jeder eingehende CC (Nummer + Wert) und jede Umschaltentscheidung in die
Scripter-Konsole geschrieben wird – öffne das Scripter-Fenster und beobachte das
Log, während du Tasten drückst, um genau zu sehen, was dein Controller sendet.
(Das ist derselbe `TRACE`-Schalter, der im obersten README unter *Parts live
umschalten* beschrieben ist; das beiliegende Beispiel wird mit ausgeschaltetem
Schalter ausgeliefert.)

Die **Screen Controls** des Concerts zeigen:

- **Den Player steuern** – Enable (den Groove starten / stoppen) und Rewind (den
  aktuellen Part auf der nächsten Eins an seinen Anfang zurückspulen).
- **Den Part wählen** – zwei der drei Arten, den aktuellen Part auszuwählen:
  Select Part (einen Part über seinen Wert wählen) und Previous / Next Part (durch
  die vier Parts steppen, an den Enden umlaufend). Die dritte Art – der Part-eigene
  CC – ist hier nicht gezeigt, da die Parts des Beispiels ihren Part-CC auf 0
  lassen. So oder so greifen die Umschaltungen auf der nächsten Eins, die Parts
  wechseln also auf dem Beat.
- **Tempo** – ein auf MainStages Tempo gemapptes Screen Control ändert die
  Wiedergabegeschwindigkeit; der Groove folgt ihr sofort, genau wie jeder anderen
  Tempoänderung des Hosts.

### Der Haken mit der Taktart

Die vier Grooves stehen in verschiedenen Taktarten (4/4, 3/4, 6/8, 7/8), und beim
Umschalten spielt der jeweilige Groove in seiner Taktart. Was ein Screen Control
**nicht** kann, ist MainStages eigene **Taktart** zu ändern – MainStage bietet
dafür kein Screen-Control-Ziel an, sodass Taktraster und Metronom des Hosts stehen
bleiben, auch wenn du auf einen Groove in einer anderen Taktart umschaltest. Stell
die Taktart in MainStage von Hand ein, wenn das Host-Raster passen soll.
