# Design notes

Short records of non-obvious design decisions, so they aren't re-litigated later.

## Enable/disable (mute) alignment: song bars vs. loop bars

**Context.** The player can be muted/unmuted live via the **Enable CC** (a
metronome-style start/stop, since metronome channel strips don't pass MIDI into
Scripter). Disable is trivial — stop emitting notes. Enable raises a question:
where in the loop does the groove resume?

**Decision — resume phase-continuous.** While muted, the loop's phase (and the
part-switch state machine) *keeps counting*; only the note output is gated. The
part's loop origin stays pinned to the bar grid the whole time, so re-enabling
picks up exactly where the groove *would* be had it never stopped — like
un-muting a mixer channel. This is what "maintain measure alignment" means here:
the groove never drifts off the song's bar grid — beat 1 of the loop always lands
on a song downbeat.

**Consequence for multi-bar loops.** A part's loop can be longer than one bar
(e.g. a 2-bar `loopBeats: 8` in 4/4). Because the origin tracks absolute song
position, re-enabling in the *second* bar of the song's current 2-bar phrase
resumes at the *second* bar of the loop pattern — not the loop's own bar 1. Song
bars and loop bars stay aligned; the loop is **not** forced back to its own
beginning on enable.

**Alternative considered — restart on enable.** Queue a restart (like the Restart
CC) so enabling always begins at the loop's bar 1 on the next downbeat. Rejected
as the default: it guarantees the loop starts at *its* bar 1, but that bar 1 then
lands on whatever song bar you happened to enable near, which can put a multi-bar
pattern out of phase with the song's bar count — the opposite of "maintain
alignment." The **Restart CC** already covers "restart from the beginning" on
demand, so nothing is lost.

**Related.** Transport stop→play re-anchors the loop origin to the current bar
(`reanchor`), so a fresh Play always starts the active part cleanly on a downbeat.
Enable/disable deliberately does *not* re-anchor — that's the whole point of
phase-continuous resume.
</content>
