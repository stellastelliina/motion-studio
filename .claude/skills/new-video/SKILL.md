---
name: new-video
description: Usa quando l'utente chiede un nuovo video, un'animazione, motion graphics, un reel, uno showreel, un teaser, una sigla, un'intro, un video per i social o un explainer in questo progetto, o chiede di rifare, allungare o migliorare un video esistente in src/videos.
---

# Nuovo video: dal brief al render

Il metodo con cui sono stati fatti i primi video del framework. Ogni passo ha un'uscita verificabile; non si passa al successivo senza.

## 1. Brief

Una frase su cosa deve provare il video, per chi, dove va (16:9, 9:16, 1:1), durata, testi obbligatori, vincoli di brand. Se manca una cosa che cambia il lavoro (formato, durata, testi), chiedila con AskUserQuestion; il resto si decide.

Uscita: il brief in 5 righe, detto all'utente.

## 2. Concept e direzione artistica

- **Un'idea sola** che attraversa il video. Per esempio un punto che rimbalza, diventa la linea che scrive la frase, il campo che si crepa in tile, la sfera, le particelle, e torna punto fermo nella firma.
- **Palette** di 3-5 colori con un ruolo scritto ciascuno (struttura, eroe, contrappunto, accento raro). **Tipi**: un display variabile, un serif per i connettivi, un mono per le etichette; scala dichiarata.
- **Consulto prima di costruire**: manda storyboard e vincoli a un subagent con `model: fable` in ruolo di direttore creativo e chiedi punto debole principale, cliché, ritmo, tagli deboli, 3 dettagli "wow". Adotta ciò che regge e scarta con motivo ciò che non regge (per esempio un "whip" oscillante legge come sfarfallio a 60 fps).

Uscita: `docs/features/<video>.md` con idea, palette, tipi, storyboard in beat, e `docs/status/<video>.md` con fase e decisioni aperte. Da qui in poi ogni scelta provvisoria, questione aperta o nota di revisione va nel file di stato, non nella feature doc.

## 3. Tempo

- Scegli BPM e durata insieme, così che il video sia una frase musicale intera: secondi = beat x 60 / BPM. 15 s a 128 BPM = 32 beat = 8 battute; 12 s a 120 BPM = 24 beat.
- Scene di lunghezza diversa: una battuta per scena diventa un metronomo e lo spettatore smette di sorprendersi alla terza.
- Prevedi un momento di quiete e un vuoto: per esempio un respiro al rallentatore prima del drop e un sedicesimo di nero e silenzio prima dell'impatto finale.
- Scrivi `timeline.ts` (griglia e storyboard), `cues.ts` (ogni evento che il suono deve colpire), `layout.ts` (cosa attraversa ogni taglio).

Uscita: `pnpm test` e `pnpm exec tsc` verdi, lo Studio mostra le scene segnaposto con la durata giusta.

## 4. Scene

- `pnpm new-video <id>` per partire; una scena alla volta, contact sheet a ogni iterazione (`pnpm stills <id>-<scena> --every=4`).
- **Principi**: anticipazione, squash and stretch, follow-through, overshoot, stagger; easing scelti per intenzione (`ease.out` entra, `ease.in` esce, `ease.snap` colpisce); spring per ciò che ha massa.
- **Ogni taglio conserva una proprietà**: posizione, raggio, colore o velocità. Scrivila in `layout.ts` prima di costruire le due scene.
- **Raccordo di oggetto solo sullo stesso oggetto**: se le due scene non hanno un oggetto in comune, il legame lo fa la camera (un movimento continuo attraverso il taglio, o un tuffo dentro un oggetto), non un morph fra cose diverse. Decidi il tipo di ogni taglio prima di costruire, in una tabella: taglio, oggetto comune (o nessuno), soluzione.
- **Un effetto di post una volta, forte**, dove c'è un motivo (per esempio l'aberrazione cromatica solo sul drop).
- **Leggibilità**: una parola sotto i 28 frame non si legge; un lockup finito va tenuto almeno un beat e mezzo. Un gesto veloce ripetuto (oscillazioni fitte) legge come sfarfallio: meglio un gesto solo che accelera.
- **HUD e colori saturi**: il blend `difference` su un colore saturo dà colori fuori palette (bianco su vermiglione diventa ciano); in quelle scene passa l'HUD a inchiostro pieno o proteggi le celle sotto il testo.
- **In parallelo**: per video lunghi, un subagent per gruppo di scene, con proprietà dei file dichiarata e contratti in `layout.ts` e `cues.ts` fissati prima. Il lead tiene i file condivisi e smista le richieste di modifica.

- **Passo fitto sul movimento**: il contact sheet a 15-30 frame nasconde i salti brevi (un elemento teletrasportato nell'angolo per pochi frame, invisibile a 30). Ogni tratto in cui qualcosa si muove o compare si guarda anche a 2-8 frame (`pnpm stills <id>-<scena> --range=a-b:2`).

Uscita: contact sheet di ogni scena guardati e sensati; `pnpm cuts <id>` dà "match" su ogni raccordo voluto (un taglio netto voluto può restare "hard").

## 5. Suono

- `score.ts` costruisce la colonna sonora con il motore di `src/framework/audio`: groove sulla griglia e sound design sui cue, mescolati nella musica e non appoggiati sopra.
- Due momenti grandi al massimo; un'identità sonora ricorrente (per esempio lo stesso pluck su ogni rimbalzo del personaggio).
- Verifica per analisi: `ffmpeg -i public/audio/<id>.wav -af ebur128=peak=true -f null -` (obiettivo circa -14 LUFS, true peak sotto -1 dBTP), spettrogramma e forma d'onda con `showspectrumpic` e `showwavespic`, guardati con Read.

## 6. Revisione

- Contact sheet dell'intero video (`pnpm stills <id> --every=15`) e fotogramma finale a piena risoluzione: deve reggere come miniatura.
- Revisione avversariale: un subagent (`model: fable`) guarda i contact sheet e dice cosa cambierebbe un senior motion designer. Correggi, poi rifai il giro.

## 7. Render e consegna

`pnpm render <id>` (aggiungi `--prores` per un master da montare altrove). Lo script rigenera l'audio e verifica il file con ffprobe; legge ogni fotogramma del master con `pnpm flicker` (vedi sotto); riporta all'utente path, durata, peso e il comando per rivederlo (`open out/<id>/<id>.mp4` lo lancia lui). Prima di consegnare:

- **Zero flicker non spiegato**: ogni sequenza che il render segnala è un flash voluto o un errore da correggere. Gli still renderizzano ogni frame da solo e non vedono gli errori del render completo (è già successo che la Lens perdesse tabella e titolo per dieci frame, mentre gli still degli stessi frame erano corretti). Per un mp4 prodotto a mano (versione per GitHub o social), `pnpm flicker <file>`.
- **Revisione sul file consegnato**: i fotogrammi di controllo si estraggono dall'mp4 (`ffmpeg -ss <s> -i <file> -frames:v 1 <png>`), non dallo Studio. Se l'utente segnala un difetto già corretto, prima di toccare il codice verifica che il suo player abbia ricaricato il file.

Alla consegna `docs/status/<id>.md` si cancella e la presa della voce scartata esce dal repo.
