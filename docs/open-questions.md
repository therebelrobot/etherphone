# Open questions, and what was decided

Every RFC is written as a _request for comments_: a problem, a direction, and a
list of questions worth arguing about. This file is where those questions stop
being open.

Each entry is marked one of three ways:

- **Decided** — the maintainer answered it. Do not relitigate without asking.
- **Settled** — the implementation answered it, and the answer is visible in the
  code. Included so the question does not get asked again.
- **Default** — nobody has answered it, so a call was taken to keep moving. The
  reasoning is written down and reversing it is a normal change of mind.

Last reviewed: 2026-10-28.

---

## #1 — Etherphone as a performance machine

| Question                                                                           | Status                                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Is the ordering right? Is the looper the keystone?                                 | **Settled.** It was. Time was the thing everything else needed, and the looper's transport is what percussion will schedule against. |
| Should anything be cut, or is "the entire performance machine" the intended scope? | **Settled.** Nothing was cut. The scope is being delivered in waves.                                                                 |
| Is there a smaller first slice that would prove the direction?                     | **Settled.** It was the looper, and it proved the diamond.                                                                           |

---

## #2 — Gesture-led recorder and looper

All six questions have answers, recorded in the issue.

| Question                                                 | Status                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How is loop length chosen?                               | **Settled.** A picker — 1, 2, 4, or 8 bars, fixed per take, recorded in the take.                                                                                   |
| Does the looper record the instrument too?               | **Settled.** No — intent only. Every layer plays whatever instrument is loaded. A take that switches instrument mid-loop is still out of scope.                     |
| Absolute frequencies, or chord + key + voicing?          | **Settled.** Intent, re-resolved against the current tonic, so changing the key transposes the loop.                                                                |
| One transport, or per-layer?                             | **Settled.** One.                                                                                                                                                   |
| How does the looper interact with live hands?            | **Settled.** Live always sounds over the loop; separate channel strips, no ducking, no "mute live" state.                                                           |
| Latency — where does quantisation start to fail audibly? | **Settled.** Arming quantises to the bar or beat line, onsets snap to a sixteenth, and playback is now scheduled ahead on the audio clock rather than on the frame. |

One documented ask is still **not built**: rendering a take to a WAV offline with
`OfflineAudioContext`. It is listed under this RFC's "Persistence" and shares
machinery with #12, so it should be built once, there.

---

## #4 — Navigate menu options by gesture

All five questions have answers, recorded in the issue.

| Question                                                            | Status                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What engages control mode, such that it can never fire by accident? | **Settled.** Both hands closed, held; and a closed hand is already silent, so opening the menu can never cost a note.                                   |
| Radial menu, or a list?                                             | **Settled.** Radial for few options, list for many (twelve keys, ten tempos).                                                                           |
| Does the cursor follow absolute hand position or relative movement? | **Settled.** Absolute, with a dead zone. Relative steering remains worth revisiting if reaching the corners is annoying — **Default**, unchanged since. |
| One hand to point and one to commit, or either hand?                | **Settled.** Two clusters, one hand each; one hand drives both in stages when only one is available.                                                    |
| What happens if the hand leaves the frame mid-dwell?                | **Settled.** The dwell is abandoned and the menu times out.                                                                                             |

Two smaller asks remain deliberately unaddressed:

- **A pass with real hands.** The engage/dwell dials are tested as a state
  machine and have never been tuned against a camera. This needs a human.
- **The fist transport is off in one-handed staging**, because one closed hand
  already means the menu there. **Default**: leave it off. Revisit only if
  one-handed players ask for the transport.

---

## #7 — A single-note instrument

| Question                                                                         | Status                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which axis is pitch, and where does volume go?                                   | **Settled.** Pitch is the left hand's height; volume stays the right hand's height.                                                                                                                                                                                                                                                                                                                                                         |
| Quantised by default, or continuous with quantisation as an option?              | **Settled.** Both, as styles: `quantised`, `glide`, `harp`.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Is there snap assistance — a pull toward the nearest scale note?**             | **Default: no.** `quantised` already snaps, and `glide` is deliberately the in-between; a pull would make the two styles converge on each other. The RFC lists a `snapStrength` constant, and it is not implemented. **Reversing this is a small change.**                                                                                                                                                                                  |
| What does _one voice_ mean for the sampler instruments?                          | **Settled.** They accept a single frequency like any other voice.                                                                                                                                                                                                                                                                                                                                                                           |
| Legato semantics — glide, retrigger, or an articulation gesture?                 | **Settled.** The style decides: `quantised` slides between degrees, `harp` re-strikes on each.                                                                                                                                                                                                                                                                                                                                              |
| Is the note readout a HUD element, or does the ribbon morph into a pitch ladder? | **Settled.** A HUD note name, plus a static reachable-note ladder in the cheat sheet.                                                                                                                                                                                                                                                                                                                                                       |
| Bassline: a distinct voice with its own envelope, or mono an octave or two down? | **Settled.** The latter — the expression hand's thumb drops the whole reading an octave.                                                                                                                                                                                                                                                                                                                                                    |
| **Does the instrument picker gain a mode column, or does the mode filter it?**   | **Decided: the mode filters it.** A voice declares which modes it can play, and the picker shows only those. Every built-in voice is currently capable of both, so today the filter passes everything — the machinery is what a drum kit needs, since a kit will be drums-only. User-loaded wavetables and samples register as capable of both, because there is no way for the player to tell us otherwise and hiding them would be worse. |
| Articulation as a separate control?                                              | **Default: no.** It is already expressed by the three styles. A fourth free axis does not exist on the expression hand — height is volume, tilt is filter, thumb is octave, finger count is vibrato. If it is wanted, it belongs as a fourth _style_, not a gesture.                                                                                                                                                                        |

---

## #8 — Remap gestures to different chords and chord sets

| Question                                                                      | Status                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does quality stay on tilt, move into the shape, or become a separate control? | **Settled.** Tilt, unchanged. `tiltPicksMode` exists for a map that would rather fix quality in the shape; no shipped map has ever set it false. |
| Exact match or subset?                                                        | **Settled.** Presets are count-based and forgiving (any two fingers is two fingers); the editor is seven deliberate slots.                       |
| **Do we need a modifier concept — a shape that transposes the next chord?**   | **Decided: yes, build it.**                                                                                                                      |
| **Is the map per-hand, or is the left/right split itself fixed?**             | **Decided: per-hand.** The split is no longer fixed: each hand can carry its own map.                                                            |
| What is the editing UI?                                                       | **Settled.** Gesture-driven, inside the Vocabulary menu, two steps (shape, then degree or nothing).                                              |
| A shareable URL or an exported config?                                        | **Settled.** A URL fragment, `#map=1450000`, which is also the storage format.                                                                   |

---

## #9 — Record and loop voice (microphone)

| Question                                                                             | Status                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Same `getUserMedia` call as the camera, or a separate one?**                       | **Decided: separate.** A denied microphone must not take the camera with it, and the camera module should stay about the camera. The prompt is asked when the player first arms a voice layer, not at startup.                               |
| **Is a voice loop pitched, or free at rate 1?**                                      | **Decided: both, per layer.** A pitched loop goes through #11's transposition and follows the key; a free loop plays at rate 1 for beatbox and percussion. This is the RFC's own lean.                                                       |
| **`AudioWorklet` only, or also `MediaRecorder`?**                                    | **Decided: `AudioWorklet` only.** Sample-accurate loop windows owned by the transport, which is what the scheduler and the loop grid expect. One path and one failure mode; browsers without it are told so rather than silently mis-timing. |
| How much latency calibration is acceptable?                                          | **Default:** an automatic measurement of round-trip latency, with a manual offset as the fallback. Not yet specified in detail.                                                                                                              |
| Does voice looping live inside the looper's take model, or as a parallel tape layer? | **Settled by design.** Inside — a voice loop is a layer, which is what the looper's per-layer engines were built for.                                                                                                                        |
| Monitoring: synced headphone monitoring, or never monitor?                           | **Default: never monitor**, and say so in the UI. Monitoring needs latency compensation and feedback protection for a feature most players will not use.                                                                                     |

---

## #10 — Percussion

| Question                                                                        | Status                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary path: live kits, a step grid, or notation?                              | **Default:** live gesture kits, then the grid, then a small in-house notation — the RFC's own proposal.                                                                                                                                     |
| Does percussion reuse the pitched `Voice` registry, or get a sibling interface? | **Default: a sibling `PercussionVoice`**, narrow, with `trigger(piece, when)`. Frequency-as-sample-selection is workable but dishonest, and the seam is already used by percussion and nothing else. To be revisited when the kit is built. |
| How are drums layered and mixed?                                                | **Settled by prior art.** The looper's layers, with per-layer level and mute.                                                                                                                                                               |
| Who owns tempo?                                                                 | **Settled.** The transport. The looper is its first user, not its owner.                                                                                                                                                                    |
| Swing or strictly quantised?                                                    | **Default:** strictly quantised first; swing is a follow-up and needs a seeded RNG, which #12's determinism question also wants.                                                                                                            |
| Gesture control of the sequencer?                                               | **Default:** pattern select and mute in the menu; a fill is later.                                                                                                                                                                          |
| Dependency or in-house notation?                                                | **Decided: in-house.** See `docs/percussion-notation-licence.md` — Strudel is AGPL and Tidal is GPL, and neither can be combined with this project's licence.                                                                               |

---

## #11 — Tuned voice loops

| Question                                                    | Status                                                                                                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which algorithm?                                            | **Default:** a phase vocoder with phase locking, because the naive one smears transients and that is the actual engineering here. WSOLA if voice quality turns out to matter more than harmonic material. |
| Formant preservation?                                       | **Default:** yes, once the basic shift works. A chipmunked voice is a character change nobody asked for.                                                                                                  |
| When is it transposed — at capture, or on every key change? | **Default:** at capture, baked to the key it was captured in, with the original kept so a re-render is possible.                                                                                          |
| Is detection ever shown?                                    | **Default:** yes, as a readout with an override. A silently misdetected loop is an inaudibly broken loop.                                                                                                 |
| Is real-time ever wanted?                                   | **Default: no.** Offline in a Worker covers the described feature. Live auto-tune of a singing voice is a different delivery path and its own decision.                                                   |
| Unpitched input?                                            | **Settled.** It is the free half of #9 and overlaps #10; it does not go through this path.                                                                                                                |
| Should the spike become a benchmark?                        | **Settled.** `scripts/benchmark-pitch-shift.mjs`, run in CI.                                                                                                                                              |

---

## #12 — Capture and export

| Question                                                                                      | Status                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which renderer leads?                                                                         | **Open, pending measurement.** `scripts/capture-spike/` exists; the numbers do not. If live 1080p cannot hold frame rate with inference running, the order flips to offline first. |
| Codec and container?                                                                          | **Default:** whatever the browser offers, preferring WebM/Opus, with the chosen type shown in the UI. A muxer is out of scope for v1.                                              |
| Is video in scope at all?                                                                     | **Default: yes**, because a clip is the stated point. Audio-only remains a preset.                                                                                                 |
| What does the frame contain?                                                                  | **Default:** the three presets the RFC proposes — Performer, Instrument, Audio only.                                                                                               |
| Loudness?                                                                                     | **Default:** render to the mix, measure loudness, offer a normalise toggle. No limiter in v1.                                                                                      |
| Length and memory?                                                                            | **Default:** cap the recording length and say so, rather than chunking to disk.                                                                                                    |
| Determinism?                                                                                  | **Default:** a recorded performance disables randomness on replay, so an offline render can reproduce the take.                                                                    |
| Metadata and naming?                                                                          | **Default:** title, key, tempo, and date in the filename; embed in the container where the format allows.                                                                          |
| Share affordance?                                                                             | **Default:** download for v1; `navigator.share` where available.                                                                                                                   |
| **Does capture own the performance view, or does that belong to the gesture menu as a mode?** | **Default:** the menu. It is a control, and the menu is where controls live; capture reads it.                                                                                     |
