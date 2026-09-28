---
paths:
  - "src/videos/**/score.ts"
  - "src/videos/**/music/**/*.ts"
  - "src/framework/audio/**/*.ts"
---

# Colonne sonore e motore audio

- **Il motore è puro**: niente DOM né API Node in `src/framework/audio/`, perché il bundle di Remotion importa i moduli delle score per sincronizzare le immagini. Solo `scripts/audio.ts` tocca il filesystem.
- **Ogni suono legato a un evento visivo parte da `cues.ts` o dallo storyboard**, mai da un beat scritto a mano nella score: spostato il cue, il suono segue.
- **Unità**: posizioni e durate in beat; parametri del suono in secondi, Hz e dB.
- **Determinismo**: il rumore passa da `Rng`/`hashSeed` con seed fissi, lo stesso codice produce lo stesso WAV bit per bit.
- **Master**: circa -14 LUFS integrati, true peak sotto -1 dBTP, al massimo due momenti che stanno chiaramente sopra il groove.
- **Verifica per analisi**: `pnpm audio <video> --verbose` (onset sui cue, loudness per battuta e per bus), poi spettrogramma e forma d'onda con ffmpeg (`showspectrumpic`, `showwavespic`) guardati con Read.
- **Il WAV buono non si perde**: il CLI scrive un file temporaneo, lo verifica con ffprobe e solo dopo lo sostituisce. Non scrivere WAV a mano in `public/audio/`.
