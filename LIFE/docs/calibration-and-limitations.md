# Calibration, camera setup and known limitations

## Camera setup checklist

1. Camera at chest height of the kneeling trainee, 1.5–2.5 m away, to the side or at about 45°.
2. The whole upper body of the trainee fits in the frame, with the arm nearest the camera (shoulder, elbow and wrist) clearly visible for the whole session.
3. Even lighting from the front or above; no bright window behind the trainee.
4. Plain, uncluttered background; nobody else standing in view.
5. Firm chest prop at a fixed position, with a visible target mark.
6. On the Live Session page, wait until **Start** is enabled (the arm has been visible for 1 second) before beginning.

## Built-in calibration (defaults)

The defaults were calibrated on a physical model of a trainee in front of a typical laptop
webcam (`dashboard/src/vision/calibrationModel.ts`; checked by `calibration.test.ts` on every
test run):

| Setting | Default | Why |
|---|---|---|
| Peak prominence | 0.012 (1.2% of frame height) | The old 0.02 missed up to 61% of compressions at 2.5 m and over half at 15 fps; values below 0.01 invented compressions from jitter while still |
| Jitter smoothing | ±70 ms | Averages at least 3 frames at 15–30 fps; a fixed 3-frame window did not smooth at all at 15–20 fps |
| Elbow threshold | 160° | Angles 10°+ away classified correctly ≥97%, 5° away ≥94% |
| Smoothing window (elbow) | 5 frames | Larger windows add lag for little gain |

Simulated performance in the recommended setup (1.5–2.5 m, side view, 20–30 fps): 94–100% of
compressions detected (4–6 cm deep, 90–130 per minute), rate error 0.8–1.7 per minute, at most
one false compression per 100 s while still. At 15 fps detection drops to about 78–91%.
Real-world accuracy must still be measured with participants (below).

## Calibration procedure

Do this once per room and camera position, and record the values used for Chapter 4.

1. **Frame rate:** start a session and check the FPS readout. Below about 20 fps, close other programs, lower the camera resolution in Settings (e.g. 960 × 540) or use a faster computer. The average frame rate and inference time are saved with every session.
2. **Elbow threshold:** with the arms held straight over the prop, note the elbow angle shown on screen; then bend the elbows slightly (what a trainer would call "not locked") and note it again. Set `angle_threshold` between the two readings (default 160°). Repeat for 2–3 people.
3. **Compression detection:** compress along with a metronome at 100, 110 and 120 BPM for 30 s each. The live BPM should settle within about 3 compressions and stay within ±5 BPM. If compressions are missed, lower `peak_prominence` a little (e.g. 0.010) or move the camera closer; if extra compressions appear while the trainee is still, raise it (e.g. 0.015).
4. **Pause handling:** pause for about 5 s (as for rescue breaths) and resume. The first compressions after the pause should not be marked slow.
5. **Evaluation:** export the test data and run `scripts/evaluate.mjs` against observer labels (see the README) to obtain the accuracy, precision, recall, F1 and BPM error for the report.

## Known limitations

- **2D measurement.** The elbow angle is computed from the image, so it depends on the camera angle. A frontal view makes bent arms look straighter; a side view is most accurate.
- **One arm is scored.** The arm nearest the camera is used as the representative arm. A trainee who bends only the far arm will not be detected.
- **Not measured:** compression depth, full chest recoil, the exact position of the hands on the center of the chest, and the quality of rescue breaths. Stacked hands, pauses and the 30:2 cycle are tracked; the pre-compression steps (scene safety, response, breathing, calling 911) are confirmed by the trainer.
- **Occlusion.** Compressions where the elbow is hidden (for example by the other arm or loose clothing) are reported as "elbow not visible" and excluded from accuracy, rather than guessed.
- **Lighting and clothing.** Low light, strong backlight and very loose sleeves reduce landmark visibility and may cause missed compressions.
- **Single person.** The pose model tracks one person; others in view can confuse it.
- **Pass mark.** The default 80 % is a placeholder and should be confirmed by a qualified first-aid trainer.
- **Not a medical device.** Certificates confirm a completed practice session only, not CPR certification.
