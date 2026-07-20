# Deferred Work

- source_spec: `docs/implementation-artifacts/spec-multi-part-and-compact-pattern.md`
  summary: On a meter change mid-playback (without a transport stop), the active part's loop origin stays anchored to the old bar grid, so its beat 1 drifts off the new downbeat.
  evidence: reanchor is only set at load and in Reset(); ProcessMIDI recomputes barBeats each block but never re-anchors partOrigin when meterNumerator/meterDenominator change. A live meter change (rare in a fixed-groove accompaniment) leaves the loop misaligned until the next stop/Reset. Deferred because correct re-anchor semantics on meter change (restart the part vs. preserve phase) need a deliberate design decision.
