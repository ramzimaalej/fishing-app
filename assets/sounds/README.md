# Notification sounds

Drop the bite-alert sound files here and register them in
`src/features/notifications/feedback.ts` (`SOUND_ASSETS`):

| Key            | Suggested file          |
| -------------- | ----------------------- |
| `classic-reel` | `classic-reel.wav`      |
| `splash`       | `splash.wav`            |
| `bell`         | `bell.wav`              |
| `sonar`        | `sonar.wav`             |

Until a file is registered, that sound gracefully degrades to a haptic tick —
nothing crashes. Keep files short (< 2 s) and small; `.wav` or `.mp3` both work
with `expo-av`.
