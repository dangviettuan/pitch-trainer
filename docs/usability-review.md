# Goal-based usability review — 2026-10-11

The primary goal is to complete a useful listening loop: hear a target, recall it, choose notes, understand an error, rehearse the correction, then continue. A short practice session should help learning as well as measure answers.

Method: independent code walkthroughs of all three modes, state transitions, phone layouts, keyboard focus, scoring and feedback; Chromium automation covers the changes below. This is an expert review and automated verification, not a study with real learners.

| Learner goal | Problem found | Change |
| --- | --- | --- |
| Choose an appropriate exercise | The opening headline described a mood, and phone settings were far below the start button. | Opening explains the exercise and current range; a direct settings control jumps to the exercise selector. |
| Listen again when uncertain | Normal practice framed replay/reference as losing the score and breaking a correct streak. | Practice accuracy and streak count every submitted answer. A separate, explicitly named unassisted measure preserves diagnostic information. |
| Trust progress | Assistance was marked before playback succeeded. | Mark assistance only after sound completes successfully. Existing stored answers remain compatible. |
| Hear and answer in one place | The phone layout applied only to narrow portrait widths, missing common landscape phones. | Short landscape viewports use side-by-side question/piano panes; small portrait screens keep the piano visible. Tiny-height viewports retain a scrolling escape. |
| Correct a slip in a melody | Correcting one note required clearing the entire sequence. | Undo removes the last note and preserves the rest. |
| Understand a wrong answer | Generic encouragement gave no direction; separate audio controls required manual comparison. Melody key colors ignored sequence positions. | Single-note feedback gives higher/lower and semitone distance; melody feedback compares each position. One control plays the chosen answer then the target. Wrong positions get an orange outline even if the same note occurs elsewhere. |
| Rehearse the correction | Every piano key was disabled after scoring. | Keys become playable after scoring; rehearsal never creates or changes a stored answer. |
| Continue with a keyboard | Replacing the exercise markup removed focused controls. | Preserve focus across playback; move to confirmation after the third note and to Next after submission. Answer entry is clearly labeled as silent. |

Practice correctness measures the first submitted answer for each question, including questions with replay/reference. Unassisted correctness, timing and adaptive sampling retain their original meaning. Rehearsing after scoring does not count as another attempt. Practice and unassisted results should not be interpreted as equivalent measures.

Remaining product questions warrant observation with learners: whether the starting note range is too broad; whether learners prefer a fixed reference before each question; whether they understand silent answer entry without explanation. A narrower beginner curriculum, per-mode progress filtering and guided reference exercises remain useful follow-ups. Automated viewport checks cannot establish touch accuracy or learning effectiveness; actual phone speakers, Safari and physical MIDI are not covered by Chromium tests.

## Follow-up from a real phone screenshot

The earlier audit missed the idle screen. The viewport assertions started after pressing Start, while initial setup and post-session results still used the tall layout. The user screenshot showed the statistics and introduction filling the screen, with the piano below it. This was an actual defect in the initial flow, not evidence of an outdated client.

The practice screen now keeps one card containing scrollable question/feedback, a separate fixed action band, and the piano. This structure is used before, during and after a session. On phones statistics live in Progress, and setup opens in a modal dialog. Fresh-browser tests assert all keys and the Start button are visible before any click at five sizes, including 390×704 to represent reduced space under Android browser chrome. They verify that the piano stays in place through settings, listening, answering, Next and results. These checks are still browser emulation rather than physical-device testing.
