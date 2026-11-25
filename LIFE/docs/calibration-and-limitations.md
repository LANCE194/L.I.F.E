# Calibration, camera setup and known limitations

## Camera setup checklist

1. Camera at chest height of the kneeling trainee, 1.5–2.5 m away, to the side or at about 45°.
2. The whole upper body of the trainee fits in the frame, with the arm nearest the camera (shoulder, elbow and wrist) clearly visible for the whole session.
3. Even lighting from the front or above; no bright window behind the trainee.
4. Plain, uncluttered background; nobody else standing in view.
5. Firm chest prop at a fixed position, with a visible target mark.
6. On the Live Session page, wait until **Start** is enabled (the arm has been visible for 1 second) before beginning.

## Calibration procedure

Do this once per room and camera position, and record the values used for Chapter 4.

1. **Frame rate:** start a session and check the FPS readout. Below about 20 fps, close other programs, lower the camera resolution in Settings (e.g. 960 × 540) or use a faster computer. The average frame rate and inference time are saved with every session.
2. **Elbow threshold:** with the arms held straight over the prop, note the elbow angle shown on screen; then bend the elbows slightly (what a trainer would call "not locked") and note it again. Set `angle_threshold` between the two readings (default 160°). Repeat for 2–3 people.
3. **Compression detection:** compress along with a metronome at 100, 110 and 120 BPM for 30 s each. The live BPM should settle within about 3 compressions and stay within ±5 BPM. If compressions are missed, lower `peak_prominence`; if extra compressions appear (for example from body sway), raise it or move the camera further to the side.
4. **Pause handling:** pause for about 5 s (as for rescue breaths) and resume. The first compressions after the pause should not be marked slow.
5. **Evaluation:** export the test data and run `scripts/evaluate.mjs` against observer labels (see the README) to obtain the accuracy, precision, recall, F1 and BPM error for the report.

## Known limitations

- **2D measurement.** The elbow angle is computed from the image, so it depends on the camera angle. A frontal view makes bent arms look straighter; a side view is most accurate.
- **One arm is scored.** The arm nearest the camera is used as the representative arm. A trainee who bends only the far arm will not be detected.
- **Not measured:** compression depth, full chest recoil, hand position, rescue breaths and interruptions in a full CPR cycle. The procedure checklist (scene safety, response, calling for help, etc.) is recorded by the trainer, not detected.
- **Occlusion.** Compressions where the elbow is hidden (for example by the other arm or loose clothing) are reported as "elbow not visible" and excluded from accuracy, rather than guessed.
- **Lighting and clothing.** Low light, strong backlight and very loose sleeves reduce landmark visibility and may cause missed compressions.
- **Single person.** The pose model tracks one person; others in view can confuse it.
- **Pass mark.** The default 80 % is a placeholder and should be confirmed by a qualified first-aid trainer.
- **Not a medical device.** Certificates confirm a completed practice session only, not CPR certification.
