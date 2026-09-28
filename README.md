# motion-studio

Motion graphics scritta in codice: un framework su Remotion (React + TypeScript) per fare video frame per frame, con immagine e suono scritti sulla stessa griglia musicale. È la base da cui partire per ogni nuovo video: `src/videos/` parte vuoto e si riempie con `make new-video`.

## Cosa c'è dentro

- **`src/framework/`**: il toolkit riusabile. Una griglia musicale (beat e battute) su cui si scrivono immagine e suono, scene con un orologio locale agganciato alla griglia, la Lens (motion blur a campioni, grana, post-produzione WebGL), tipografia cinetica con crenatura esatta, un motore audio procedurale senza dipendenze, la voce fuori campo messa sulla griglia.
- **`src/videos/<id>/`**: un video. Timeline e storyboard, cue condivisi tra immagine e suono, contratti di layout tra le scene, scene, colonna sonora. `registry.ts` li elenca tutti.
- **`scripts/`**: colonna sonora, voce fuori campo, contact sheet e controllo dei raccordi per la QA visiva, render finale verificato, scaffolder di nuovi video e verifica del template che usa.
- **`templates/video/`**: il punto di partenza di ogni nuovo video, già funzionante (titolo, frase, cartello finale e colonna sonora d'esempio).

## Prerequisiti

- **Node** 22 o più e **pnpm** 11 (`package.json` rifiuta pnpm 10).
- **ffmpeg** e **ffprobe** (`brew install ffmpeg`): li usano colonna sonora, voce, render, contact sheet e raccordi.
- **Git LFS** (`brew install git-lfs`): i binari pesanti dei riferimenti di un video (`assets/<video>/reference/`) passano da LFS (`.gitattributes`).

`make install` verifica ffmpeg e Git LFS, scarica i riferimenti e installa le dipendenze.

## Un nuovo video

```bash
make install
make new-video ID=launch-teaser TITLE="Launch Teaser" FORMAT=vertical
make dev          # rigenera le colonne sonore e apre Remotion Studio su http://localhost:4450
```

`new-video` crea `src/videos/launch-teaser/` dal template, lo registra e genera la prima colonna sonora. Da lì: BPM e scene in `timeline.ts`, eventi in `cues.ts`, poi le scene. Il metodo completo, dal brief al render, è nella skill di progetto `.claude/skills/new-video/`.

Lo Studio mostra per ogni video il montaggio completo e una composizione per scena. Motion blur, grana e post si vedono in anteprima solo con HTML-in-canvas attivo in Chrome (`chrome://flags/#canvas-draw-element`); senza, la Lens mostra l'immagine pulita. Il render da riga di comando li applica sempre.

## Render

```bash
make render VIDEO=launch-teaser                  # master out/launch-teaser/launch-teaser.mp4 (H.264 CRF 16) + -web.mp4 (HEVC) + poster
make render VIDEO=launch-teaser ARGS=--prores    # anche il .mov ProRes 422 HQ
make render-draft VIDEO=launch-teaser            # metà risoluzione, veloce
make stills VIDEO=launch-teaser ARGS=--every=30  # contact sheet in out/launch-teaser/stills/
make cuts VIDEO=launch-teaser                    # raccordi tra scene: SSIM e foglio dei tagli
```

Un video con narratore ha anche la traccia della voce, scritta dalla presa in `assets/<video>/voice/` (versionata in FLAC): la generano `make dev` e il render insieme alla colonna sonora, a mano con `pnpm voice <video>`.

Il render rigenera sempre la colonna sonora prima dell'immagine e controlla ogni file prodotto con ffprobe: si ferma se manca la traccia video o quella audio, e riporta codec, risoluzione, frame rate, durata e peso.

## Comandi

`make help` elenca tutti i target.

## Licenza di Remotion

Remotion è gratuito per persone, non profit e aziende fino a 3 dipendenti; oltre serve la Company License: [remotion.pro/license](https://www.remotion.pro/license). I font in `public/fonts/` sono tutti OFL, con la licenza accanto a ogni famiglia.

## Documentazione

- [Architettura](docs/ARCHITECTURE.md): perché Remotion, i livelli, la Lens, l'audio, i compromessi.
- [Convenzioni](docs/CONVENTIONS.md): come si scrive una scena, il tempo in beat, i contratti tra scene, dove va ogni file.
- `docs/features/<video>.md` e `docs/status/<video>.md`: cosa è un video e a che punto è, uno per video (li crea il metodo di `.claude/skills/new-video/`).
