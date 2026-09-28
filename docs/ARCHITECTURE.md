# Architettura

## Visione d'insieme

Un video è codice: ogni frame è una funzione pura del tempo, e il tempo è musicale. Il framework serve a produrre motion graphics di qualità con un coding agent nel ciclo: l'agent scrive le scene, le guarda come contact sheet, corregge, e il render finale è riproducibile bit per bit. Ogni nuovo video parte da `templates/video/`, che usa già griglia, scene, Lens e colonna sonora.

## Perché Remotion

- **Alternative scartate**: Motion Canvas e Revideo (editor ottimo, render headless meno maturo, ecosistema piccolo); pipeline propria con GSAP, Playwright e ffmpeg (controllo totale, ma rifare render parallelo, mix audio e anteprima); After Effects o Blender (non pilotabili da un agent con la stessa affidabilità).
- **Cosa dà Remotion**: React e TypeScript, render frame-accurate in parallelo, Studio per l'anteprima, CLI per singoli frame (la base della QA visiva), Three.js, effetti WebGL, motion blur, font e media già integrati.
- **Costo**: licenza aziendale oltre i 3 dipendenti (vedi README). Versione fissata a 4.0.529: `Lens.tsx` usa una prop interna di HtmlInCanvas, da ricontrollare a ogni upgrade.

## Livelli

- **`framework/time`**: la griglia (`createGrid`: beat e battute in frame e secondi) e lo storyboard (`defineStoryboard`: scene come intervalli in beat che tassellano la timeline senza buchi né sovrapposizioni; `lead` e `tail` per le sovrapposizioni visive dei passaggi). Moduli puri, usati anche dal renderer audio.
- **`framework/video`**: `SceneSlot` e `useScene` (orologio locale della scena: frame, `beat()`, `at(cue)`), `scenePreview` (ogni scena anche come composizione Studio, con lo stesso timing del montaggio), `defineVideo` e `VideoCompositions` (il registry diventa il Root), `createLookResolver` (motion blur e post per scena).
- **`framework/fx/Lens`**: la camera di ogni video, vedi sotto.
- **`framework/motion`**: easing per intenzione (`ease.out`, `ease.snap`, `ease.back`...), `tween`/`keys` stile After Effects, spring preimpostate, `pulse` per reagire ai colpi, caso deterministico.
- **`framework/type`**: font locali variabili, misura del testo nel motore di layout vero, `fitWidthAxis` (giustifica una parola muovendo l'asse `wdth`), `KineticWord` (lettere animabili una per una senza perdere la crenatura).
- **`framework/hud`**: crocini, timecode, contatore di frame.
- **`framework/three`**, **`framework/dataviz`**, **`framework/fx/worlds`**: moduli per scene 3D, visualizzazione di dati e zoom infiniti, riusabili (vedi i commenti in testa a ogni file).
- **`framework/audio`**: il motore audio, vedi sotto.
- **`framework/voice`**: la voce fuori campo sulla griglia (`defineVoice`, `layoutVoice`, `voiceLines`), vedi sotto. Modulo puro, usato dallo script e dalle score.
- **`videos/<id>/`**: `timeline.ts` (griglia e storyboard), `cues.ts` (eventi in beat), `layout.ts` (contratti tra scene), `theme.ts`, `look.ts`, `score.ts`, `Video.tsx` (il montaggio), `scenes/`; se c'è un narratore `voice.ts` e il generato `voice.timing.ts`. Lo scheletro completo, con `components/`, `data/` e `music/`, è in `docs/CONVENTIONS.md`, "Dentro un video".

## Flusso dei dati

`timeline.ts` definisce griglia e storyboard; il montaggio monta ogni scena in uno `SceneSlot`; la scena legge il proprio orologio con `useScene()` e piazza ogni animazione su un beat o su un cue di `cues.ts`. Lo stesso `cues.ts` è letto dalla colonna sonora: un colpo spostato di mezzo beat si sposta nell'immagine e nel suono insieme. I due lati di un taglio leggono posizione, raggio e colore da `layout.ts`, così il raccordo resta esatto quando una scena cambia.

## La Lens

Un solo `HtmlInCanvas` per video filma tutte le scene:

- **Motion blur da otturatore**: i figli vengono renderizzati N volte a frame frazionari distribuiti sull'angolo di otturatore e mediati. N è deciso frame per frame dal `look` della scena, quindi il costo si paga solo dove qualcosa si muove. La media si accumula su un canvas half-float: a 8 bit ogni contributo di 1/N viene arrotondato e con 24 campioni l'inchiostro #0E0E10 diventava #191919.
- **Grana** disegnata in 2D dentro la stessa passata, con tile di rumore deterministiche.
- **Effetti WebGL** (`@remotion/effects`: aberrazione, zoom blur, halftone...) solo sui frame a campione singolo: con effetti in catena le catture dei campioni aggiuntivi arrivano vuote (verificato). Le scene WebGL girano comunque a campione singolo, perché ogni campione clonerebbe il contesto GL.
- **Fuori dalla Lens**: l'HUD (non deve sbavare sotto zoom blur e motion blur, ma si fonde ancora con l'immagine in `difference`) e l'audio (i campioni lo duplicherebbero).
- **WebGL**: un canvas WebGL nel sottoalbero catturato non viene ricatturato quando R3F ridisegna, e in una tab tutti i frame ripetono il primo. `framework/three/LensThreeCanvas` disegna fuori schermo, copia in due specchi 2D alternati (lo scambio forza una nuova cattura) e trattiene il frame finché la Lens non ha ridipinto.
- **In Studio**: senza HTML-in-canvas nel browser la Lens si fa da parte e mostra l'immagine pulita.

## Audio

Motore procedurale in TypeScript senza dipendenze (`framework/audio`): oscillatori, filtri, inviluppi, dinamica, riverbero e voci (batteria, basso, synth analogici e FM, pianoforte e mallet a sintesi modale, coro, effetti; l'elenco è in `framework/audio/voices/`) resi offline a 48 kHz, deterministici. Ogni video descrive la propria colonna sonora in `score.ts` a partire da griglia e cue; `pnpm audio` scrive `public/audio/<id>.wav` (generato, fuori da git), che il montaggio monta con `<Audio>`. `pnpm dev` e `pnpm render` lo rigenerano sempre prima di mostrare o renderizzare.

La voce fuori campo, quando c'è, comanda il tempo del video, ma immagine e musica restano in beat: `framework/voice` mette ogni frase sulla prima suddivisione della griglia libera dopo la frase precedente e la sua pausa, così una frase è un evento in beat come un cue e la musica chiude le battute con le parole. Una frase che deve colpire a metà si divide in sotto-frasi alle pause interne; la colonna sonora scende sotto ogni frase con `s.duck`, un'automazione di volume per bus costruita dagli stessi intervalli. `pnpm voice` misura le frasi registrate (una per file, in FLAC, in `assets/<video>/voice/<presa>/`, versionate), le pulisce e scrive la traccia e i tempi (`voice.timing.ts`), che scene e colonna sonora importano.

## QA visiva

L'agent non guarda il video: guarda fotogrammi. `pnpm stills` renderizza frame scelti e li affianca in un contact sheet; `pnpm cuts` confronta i due lati di ogni taglio con SSIM, così un raccordo che salta si vede come numero prima ancora che a occhio. `pnpm flicker` chiude il buco che resta: gli still renderizzano ogni frame da solo, quindi un errore che esiste solo nel render completo lo trova solo la lettura dell'mp4, fotogramma per fotogramma. Le scene si renderizzano anche da sole (`<video>-<scena>`), con lo stesso timing del montaggio.

## Decisioni chiave

- **60 fps**: movimento fluido e motion blur a campioni credibile; il costo di render è gestito dai campioni adattivi.
- **Tempo in beat**: la griglia arrotonda al frame intero, l'audio suona sui secondi esatti; lo scarto massimo è mezzo frame (8 ms a 60 fps), sotto la soglia percettiva di sincronia.
- **Niente Tailwind**: in un video quasi ogni stile è funzione del frame, i token vivono in `theme.ts` come costanti TypeScript.
- **Font locali OFL** invece di Google Fonts a runtime: render offline e assi variabili completi (`wght`, `wdth`), dichiarati per intero così il browser non simula mai il grassetto.
- **Audio procedurale** invece di musica generata o di repertorio: sincronizzato ai cue per costruzione, riproducibile, gratuito. Una traccia esterna resta possibile sostituendo il WAV.
- **Master H.264 più copia HEVC** invece di un H.264 con tetto di bitrate: grana e particelle a 60 fps rendono pesante il master (H.264 CRF 16) e un tetto di bitrate le impasta. Ogni render completo scrive quindi anche `<video>-web.mp4` in HEVC CRF 24, circa il 40% del peso del master.

## Boundary

- `framework/` non importa mai da `videos/`.
- Le scene non usano `HtmlInCanvas`: la Lens è l'unica (non si annida).
- Gli script Node importano solo moduli puri (timeline, cue, score): mai componenti React o moduli che toccano il DOM.
