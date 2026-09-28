# Convenzioni di codice

Regole specifiche di questo progetto. Per gli standard trasversali vale il CLAUDE.md globale; le regole sulle scene si caricano da `.claude/rules/remotion-scenes.md`.

## Generali

- TypeScript strict, line length 100 (Prettier). Import con alias `@/` tra moduli (`@/framework/...`), relativi dentro la cartella di un video e dentro un modulo del framework.
- Codice, identificatori e commenti in inglese; testi a schermo nella lingua del video.

## Dove va cosa

Ogni file è in uno di quattro stati, e ogni stato ha le sue radici. Così si sa senza pensarci cosa va in git, cosa si può cancellare e cosa, se si perde, va rifatto a mano.

| Stato    | Dove                                                                 | In git | Cosa vuol dire                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sorgente | `src/`, `scripts/`, `tests/`, `templates/`, `docs/`, `public/fonts/` | sì     | Da qui si rigenera tutto il resto.                                                                                                                                                                                                      |
| Input    | `assets/<video>/`                                                    | sì     | Materiale che il codice legge ma non produce, o da cui sono nate le scelte del video. Le prese della voce (`voice/<presa>/`) servono al render; i riferimenti (`reference/`) servono a chi ci lavora dopo, i binari pesanti in Git LFS. |
| Output   | `out/<video>/`                                                       | no     | Generato dal codice: render, clip e contact sheet si rifanno con i comandi. Fuori da git perché ogni render committato resterebbe nella storia e il repo crescerebbe.                                                                   |
| Scratch  | `public/audio/`, `build/`, `out/template-check/`                     | no     | Si cancella in qualsiasi momento (`make clean`, `public/audio/` lo rifà `pnpm audio`) senza perdere lavoro.                                                                                                                             |

- **In `out/` non ci sono sorgenti né input unici**: tutto si rigenera dal codice. Ogni video ha la sua cartella `out/<video>/`: i render in radice (`pnpm render` scrive lì), una sottocartella per strumento (`stills/`, `cuts/`, `audio-debug/`), i file da ascoltare o confrontare in `audio/`, gli esperimenti usa e getta in `lab/`. Fuori dai video c'è solo `out/template-check/`, di `make template`.
- **Il codice che serve due volte si versiona.** Uno script nato in `out/<video>/lab/` che si rilancia va in `src/videos/<id>/tools/` se serve a quel video solo, in `scripts/` (con il suo comando in `package.json`) se serve a tutti, altrimenti si cancella a fine lavoro. Da un'analisi resta il risultato, scritto nella doc del video.
- **Il materiale del cliente o di terzi sta in `assets/<video>/reference/`**: video di riferimento, schermate di siti, press kit, dati grezzi. È in git perché chi riprende il video trovi ciò da cui sono nate le scelte; video, audio e immagini passano da Git LFS (`.gitattributes`), il testo resta in git normale. Non entra mai nel video così com'è, e la provenienza di ogni file è scritta nella doc del video. Per questo il repo resta privato.
- **Ciò che il video usa di un input si versiona come dato**, in `src/videos/<id>/data/` o nel componente che lo disegna, con la fonte e il procedimento nel commento in testa (i path del logo dal file del press kit, le coordinate di una molecola dal PDB).
- **Le prese della voce si versionano in FLAC**: senza perdita (la traccia e i tempi che ne escono sono identici bit per bit a quelli del WAV) e circa un terzo più leggere. Una presa scartata si toglie dal repo quando la scelta è fatta.
- **`public/` contiene solo ciò che il renderer serve con `staticFile()`**: i font, versionati con la licenza accanto, e l'audio generato da `pnpm audio` e `pnpm voice`.
- **Un video ha due doc: cosa è e a che punto è.** `docs/features/<video>.md` descrive il video (idea, direzione artistica, storyboard, suono, riferimenti) e cambia insieme al codice. `docs/status/<video>.md` tiene lo stato finché il video è in lavorazione: fase, scelte provvisorie, questioni aperte, note di revisione da applicare, cosa manca al render finale. Lo stato non entra mai nella feature doc né in `CLAUDE.md`; alla consegna il file di stato si cancella (la storia resta in git).
- **Una pagina generata in `docs/` ha la sua sorgente nella cartella omonima e un comando che la rifà** (in `scripts/`, con il suo comando in `package.json`).

### Dentro un video

Ogni video ha lo scheletro di `templates/video/`, così chi apre un video che non conosce trova ogni cosa dove l'ha trovata negli altri.

- **In radice solo i file-contratto, uno per ruolo**: `index.tsx` (le composizioni), `Video.tsx` (il montaggio), `timeline.ts`, `cues.ts`, `layout.ts`, `theme.ts`, `look.ts`, `score.ts`; se servono, `voice.ts` con il suo `voice.timing.ts` generato e `styleframes.tsx`.
- **`scenes/<scena>/`**: `index.tsx` e i file che usa solo quella scena.
- **`components/`**: il codice usato da due o più scene, o dagli styleframe; componenti React e i dati puri che disegnano.
- **`data/`**: dati importati da fonti esterne, con la fonte in testa.
- **`music/`**: il codice della colonna sonora oltre `score.ts` (arrangiamento, versioni alternative).
- **`tools/`**: script Node di quel video soltanto (versioni della musica, verifiche del missaggio, analisi, schizzi). Si lanciano con `pnpm tsx src/videos/<id>/tools/<script>.ts`, scrivono in `out/<video>/` e nessun file del video li importa, così non entrano nel bundle.
- **Un file nasce nella scena che lo usa.** Passa in `components/` quando lo usa una seconda scena, in `src/framework/` quando lo usa un secondo video, con un commento in testa che dice cosa fa e quando usarlo. Il percorso inverso vale per il codice che smette di essere condiviso.

## Tempo

- Si scrive in beat: `useScene().beat(b)` per i beat della scena, `at(cues.x)` per gli eventi condivisi, `atExact()` per la fisica e le curve continue. Un numero di frame scritto a mano in una scena è un bug in attesa del primo cambio di BPM.
- Gli eventi che il suono deve colpire stanno in `cues.ts`, mai duplicati nella scena o nella colonna sonora.
- Tutto è funzione del frame: niente `Math.random()`, `Date`, transizioni o animazioni CSS, `useFrame()` di React Three Fiber. Il caso viene da `rand()`, `wiggle()`, `prng()` con seed fissi.
- Con motion blur la scena riceve frame frazionari: seed, indici e cambi di stato istantanei si decidono su `Math.round(frame)`, così tutti i campioni di un frame concordano.

## Scene

- Un modulo scena esporta `Scene: React.FC` e, se serve, `look: SceneLook` (campioni di motion blur, otturatore, effetti, modo dell'HUD).
- I passaggi tra scene leggono `layout.ts`: posizione, raggio e colore di ciò che attraversa il taglio stanno lì.
- Niente `HtmlInCanvas` nelle scene; `<Solid>` e `<CanvasImage>` con `effects` sono ammessi. Una scena WebGL va dichiarata in `webgl` del `look.ts` del video.
- Il testo che dipende dalle metriche (giustificazione, riquadri attorno alle parole) si misura con `framework/type/measure` dopo `useFontsReady()`, mai a occhio.

## Direzione artistica

- Ogni taglio tiene fissa almeno una proprietà (posizione, raggio, colore o velocità), e nessun taglio passa per una pagina vuota.
- **Un raccordo di oggetto si fa solo se l'oggetto è lo stesso nelle due scene**: un groviglio che si scioglie in una riga funziona se sono gli stessi nodi. Mai un morph fra due cose diverse (una card di risultati svuotata che diventa un foglio di calcolo, un tag che diventa un'altra attività): l'oggetto perde identità e l'occhio lo sente. Se non c'è un oggetto comune, lega la camera: un solo movimento continuo che attraversa il taglio, come se le due scene stessero sulla stessa tavola, o un tuffo dentro un oggetto che contiene la scena dopo; se neanche questo ha senso, un taglio netto sul beat.
- Gli elementi del marchio di un cliente si usano solo come li usa il marchio: una parte del logo non si stacca dal logo per diventare un personaggio o un'icona.
- Un effetto di post si usa una volta, forte, dove ha un motivo; mai come vernice.
- Ogni colore ha un ruolo scritto in `theme.ts`; l'accento raro resta raro.
- Una scena deve reggere come fotogramma fermo: se il contact sheet non si legge, non si legge neanche in movimento.
- Un elemento che rappresenta un oggetto reale (una molecola, un grafico di dati, un logo, un'interfaccia, un numero) si costruisce da una fonte verificabile, mai a occhio: una molecola dalle coordinate PDB, il logo dal file del press kit, i numeri dal sito del cliente e confermati da lui. Senza una fonte si sceglie un altro soggetto.

## Verifica

- Prima di dire che una scena è fatta: `pnpm stills <video>-<scena> --every=4` e il contact sheet va guardato; poi `pnpm cuts <video>`: ogni raccordo voluto deve risultare "match". Prima di dire che un video è finito: il render riporta "no flicker" (o ogni sequenza segnalata è un flash voluto) e la revisione si fa su fotogrammi estratti dall'mp4, non sugli still.
- `make check` (format, lint, typecheck, template, test, build) prima di un commit che tocca più file.
- I test coprono le parti pure del framework (griglia, storyboard, motion, motore audio e strumenti, voce fuori campo in griglia); le scene si verificano a vista.
