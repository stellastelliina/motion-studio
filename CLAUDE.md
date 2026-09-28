# motion-studio - Istruzioni per Claude

## Cos'è

Framework per motion graphics scritta in codice su Remotion 4 (React 19, TypeScript strict, pnpm), usato come base per creare video: `src/videos/` parte vuoto e ogni nuovo video nasce da `templates/video/` con `pnpm new-video`. Ogni frame è funzione pura del tempo; il tempo è una griglia musicale condivisa con la colonna sonora procedurale e, quando c'è, con la voce.

Nato come copia scollegata di `Yellow-Tech-Lab/motion-studio` (di Simone Salerno), da cui sono stati tolti i video, gli output e i riferimenti: questo repo non ha remote verso quello e non lo deve mai avere.

## Glossario

- **Beat, battuta**: unità di tempo della griglia (`createGrid`), 0-based. A 128 BPM e 60 fps un beat vale 28.125 frame.
- **Storyboard**: le scene di un video come intervalli in beat che tassellano la timeline (`defineStoryboard`). **Lead/tail**: frame in cui una scena è montata prima o dopo il suo intervallo, per i passaggi.
- **Cue**: evento in beat che immagine e suono devono colpire insieme, in `src/videos/<id>/cues.ts`.
- **Contratto di layout**: posizione, raggio o colore che attraversa un taglio, in `layout.ts`; lo leggono entrambe le scene.
- **Lens**: la camera del video (`framework/fx/Lens.tsx`): motion blur a campioni, grana, effetti WebGL. **Look**: le impostazioni della Lens frame per frame, contribuite da ogni scena.
- **Voce, frase**: un video con narratore è scandito dalla voce. Ogni frase registrata ha un id in `voice.ts` e parte su una suddivisione della griglia: `line("id").start` è un beat, come un cue.
- **Presa**: una registrazione completa della voce, una cartella con un file per frase in `assets/<video>/voice/<presa>/`.
- **Styleframe**: fotogramma chiave approvato prima di animare (`styleframes.tsx`); la scena ci arriva e ci riparte.
- **Contact sheet**: griglia di frame renderizzati da `pnpm stills`, lo strumento di QA visiva.

## Comandi

- `pnpm dev`: rigenera le colonne sonore e apre lo Studio su http://localhost:4450.
- `pnpm new-video <id> [--title=..] [--format=landscape|vertical|square]`: scaffold da `templates/video/`, registrazione in `src/videos/registry.ts` e prima colonna sonora.
- `pnpm stills <composizione> [--every=N | --range=a-b:step | --frames=a,b]`: contact sheet in `out/<video>/stills/<composizione>-sheet.jpg`, frame singoli in `out/<video>/stills/<composizione>/element-<frame>.jpeg`. Le composizioni sono `<video>` e `<video>-<scena>`.
- `pnpm cuts <video>`: per ogni taglio renderizza l'ultimo frame prima e il primo dopo, ne misura la somiglianza (SSIM) e li affianca in `out/<video>/cuts/sheet.jpg`. Un raccordo voluto deve dare "match".
- `pnpm flicker <video | file>`: legge ogni fotogramma dell'mp4 e segnala sequenze di 1-12 fotogrammi che saltano e tornano (un elemento perso nel render completo, che nessuno still mostra). `pnpm render` lo esegue da solo sul master.
- `pnpm audio [video]`: scrive `public/audio/<video>.wav` da `src/videos/<video>/score.ts`.
- `pnpm voice <video> [--take=<cartella>]`: prende un file per frase da `assets/<video>/voice/<take>/` (FLAC, in git), taglia i silenzi, livella con un guadagno, mette ogni frase su una suddivisione della griglia secondo `voice.ts` e scrive `public/audio/<video>-voice.wav` e `voice.timing.ts` (generato ma committato: scene e score lo leggono). Segnala le frasi tagliate dall'export.
- `pnpm render <video> [--draft] [--prores] [--frames=a-b]`: audio, poi immagine, poi verifica ffprobe. Output in `out/<video>/`; il poster solo nel render completo.
- `make check`: format, lint, typecheck, template, test, build. `make template` scaffolda il template in `out/template-check/` e ci passa tsc ed ESLint, perché il template grezzo non compila. `pnpm test` gira con `tsx --test`.
- Un pacchetto `@remotion/*` si aggiunge con `pnpm exec remotion add <pacchetto>` (allinea la versione), mai con `pnpm add`.

## Convenzioni specifiche

- Il tempo si scrive in beat e in cue, mai in frame letterali: `useScene()` dà `beat()`, `at()`, `atExact()`. Dettaglio in `docs/CONVENTIONS.md` e nella rule `.claude/rules/remotion-scenes.md`, che si carica sui file delle scene.
- Un evento udibile nasce in `cues.ts` e da lì lo leggono scena e `score.ts`: un colpo aggiunto solo nella scena resta muto.
- Dove va un file lo decidono le regole di `docs/CONVENTIONS.md` "Dove va cosa": sorgente in git; input in `assets/<video>/` (prese della voce e riferimenti in git, i binari dei riferimenti in Git LFS); il generato in `out/<video>/`, fuori da git come `public/audio/` e `build/`. Mai codice in `out/`: uno script che si rilancia va in `src/videos/<id>/tools/` se è di un video, in `scripts/` se è di tutti.
- Un file nasce nella cartella della scena che lo usa, passa in `components/` del video quando lo usa una seconda scena, in `src/framework/` quando lo usa un secondo video, con un commento in testa. `framework/` non importa mai da `videos/`.
- Dopo una modifica visiva la verifica è il contact sheet guardato con Read, non il typecheck.
- Lo stato di un video in lavorazione (scelte provvisorie, questioni aperte, note di revisione, cosa manca al render finale) sta in `docs/status/<video>.md`, mai in `docs/features/<video>.md`, che descrive solo il video. Una decisione presa o una nota applicata si aggiorna lì nello stesso commit; a consegna il file si cancella.

## Gotcha

Scene, Lens, WebGL e misure del testo hanno i loro gotcha in `.claude/rules/remotion-scenes.md`, che si carica sui file di `src/videos/`, dei componenti del framework e del template. Qui restano quelli di comandi e dipendenze.

- **Il WAV deve esistere prima di renderizzare**, anche con `--muted`: il renderer scarica gli asset e un 404 fa fallire il render. `pnpm render` e `pnpm dev` generano colonna sonora e voce (`pnpm audio` lancia `pnpm voice` per ogni video con `voice.ts`); per un render a mano, prima `pnpm audio <video>`.
- **Serve pnpm 11**: `engines` in `package.json` rifiuta pnpm 10, e gli script lanciano `pnpm` a loro volta, quindi va trovato nel PATH (non basta `npx pnpm@11`).
- **I riferimenti pesanti sono in Git LFS**: un nuovo tipo di binario tra i riferimenti va aggiunto a `.gitattributes` prima del commit.
- **pnpm 11 blocca gli script di build non approvati** (`ERR_PNPM_IGNORED_BUILDS`): `pnpm approve-builds <pacchetto>`, non interattivo.
- **`create-video --no-tailwind` via `pnpm create` installa Tailwind lo stesso**: se si rifà lo scaffold, va tolto a mano.
- **Remotion è fissato a 4.0.529**: `Lens.tsx` usa la prop interna `_remotionInternalCanvasSiblings`. Prima di un upgrade, rileggi `Lens.tsx` e verifica il motion blur con un contact sheet di una scena veloce.
- **I frame renderizzati hanno lo zero-padding del frame più alto**: oltre 999 frame Remotion scrive `element-0467.png`, non `element-467.png`. Uno script che legge un render cerca i file per numero (`scripts/cuts.ts`), mai per nome costruito.
- **`pnpm cuts` dà "match" anche quando un piccolo elemento salta**: su un fondo quasi vuoto l'SSIM resta ~1. Un raccordo con contratto (`layout.ts`) si verifica guardando i due frame in `out/<video>/cuts/`, non il numero.

## Tocca tutte le superfici

- **Nuova scena**: storyboard in `timeline.ts`, registry in `scenes/index.ts`, cue in `cues.ts`, suono in `score.ts`, contratti con le scene vicine in `layout.ts`, `look` (campioni, HUD), lista `webgl` se monta un canvas GL, `docs/features/<video>.md`.
- **Scena spostata o allungata**: i cue che la riguardano e le scene adiacenti (lead, tail, contratti).
- **Presa o pause della voce cambiate**: `pnpm voice <video>`, poi `pnpm cuts` e i contact sheet. Tagli, cue e phrases si ricalcolano da soli; gli scarti misurati a mano dentro una frase (es. `line("id").start + 7 / 12` in `cues.ts`) valgono solo per la presa su cui sono stati misurati e vanno rimisurati.
- **API del framework cambiata**: `templates/video/` (`make template` lo verifica), i test in `tests/`, la skill `.claude/skills/new-video/`, i video in `src/videos/`.

## Cosa non compromettere mai

- Determinismo: lo stesso commit produce lo stesso video, frame per frame e campione per campione.
- La griglia come unica fonte del tempo: immagine e suono non devono poter divergere.
- I contratti di layout: un raccordo che salta di un pixel si vede.

## Puntatori

- `README.md`: cosa fa il progetto e come si usa.
- `docs/ARCHITECTURE.md`: perché Remotion, i livelli, la Lens, l'audio, i compromessi.
- `docs/CONVENTIONS.md`: regole di codice e di direzione artistica.
- `docs/features/<video>.md`, `docs/status/<video>.md`: cosa è ogni video e a che punto è; da leggere prima di riprendere un video.
- `.claude/skills/new-video/`: il metodo per un nuovo video, dal brief al render.
- `.claude/skills/remotion-best-practices/`: le skill ufficiali di Remotion (API aggiornate), fissate da `skills-lock.json`.
