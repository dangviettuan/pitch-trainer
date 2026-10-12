# Piano recordings

These files are a subset of Salamander Grand Piano by **Alexander Holm**, recorded on a **Yamaha C5**. The MP3 exports come from [Tonejs/audio](https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander), pinned at commit `efd8296360f9526e379bfbe5c1698ff54d6a1d34`. Upstream's README calls the library V2 and includes a V3 changelog; we do not claim this subset is the full multi-velocity library.

License: **Creative Commons Attribution 3.0 Unported**, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Original author and attribution remain visible in the app settings. Use does not imply endorsement.

The thirteen original MP3 files are byte-for-byte unchanged; `sources.json` records original filenames, byte sizes, hashes and measured tuning deviations. Files are renamed to their MIDI anchor numbers for lookup. Playback covers C3–C6, choosing the nearest anchor (at most one semitone away inside this range). Playback rate also corrects each anchor's measured fundamental toward A440 equal temperament. Recorded attacks are retained and each exercise note ends with a short gain release. This is a lightweight sampled piano, without sustain-pedal or velocity-layer simulation.

Tuning measurement: decode mono at 44100 Hz; inspect the fundamental near the expected note over 0.35–1.8 seconds, using a Hann window, a 262144-point FFT and parabolic interpolation of the log magnitude. Measurements are approximate; real piano partials are not perfectly harmonic. Corrections are applied at playback rather than modifying the source files.

All thirteen samples total **843,324 bytes** and are hosted with the app. The service worker precaches them with the app shell so an installed offline session can also use notes that have never been played online. No external audio CDN is contacted at runtime.
