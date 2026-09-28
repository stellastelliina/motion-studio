---
paths:
  - "src/videos/**/*.tsx"
  - "src/videos/**/*.ts"
  - "src/framework/**/*.tsx"
  - "templates/video/**/*.tsx"
  - "templates/video/**/*.ts"
---

# Scene e composizioni Remotion

- **Tutto è funzione del frame**: niente `Math.random()`, `Date`, CSS `transition`/`animation`, `useFrame()` di R3F, shader che avanzano da soli. Il caso viene da `rand()`/`wiggle()` di `@/framework/motion/random` con seed fissi.
- **Il tempo si scrive in beat, non in frame**: `useScene().beat(b)` per i beat locali, `at(cue)` per i cue di `cues.ts`. Un numero di frame scritto a mano nella scena è un bug in attesa del primo cambio di BPM.
- **I passaggi tra scene leggono `layout.ts`**: posizione, raggio e colore condivisi stanno lì, non duplicati nelle due scene.
- **Frame frazionari**: con motion blur la Lens passa frame non interi (`useCurrentFrame()` può valere 41.37). Seed, indici e cambi di stato istantanei (un colore che scatta, un elemento che compare) si decidono su `Math.round(frame)`: così tutti i campioni dello stesso frame concordano. Con `floor` il cambio cade a metà otturatore e il blur media i due stati in colori fuori palette (un'inversione di colore su `floor` produce viola e marrone).
- **Solo i font di `public/fonts/`, registrati in `framework/type/fonts.ts`**: un font di sistema (Tahoma, Verdana) rende il render diverso da macchina a macchina e rompe il determinismo, anche per un dettaglio come un'interfaccia d'epoca.
- **Misure del testo solo dopo `useFontsReady()`**: prima i font non sono caricati e le metriche sono quelle del fallback. Mai stimare larghezze a occhio.
- **Niente HtmlInCanvas dentro una scena**: la Lens del video è già un HtmlInCanvas e non si annida. Gli effetti di una scena passano dal suo export `look()`; `<Solid>`/`<CanvasImage>` con `effects` sono ammessi.
- **Effetti WebGL e motion blur non convivono nella stessa Lens**: con `effects` in catena le catture dei campioni extra arrivano vuote e resta 1 campione su N (immagine scura). La Lens applica gli effetti solo sui frame a campione singolo; per un effetto su una scena veloce, scegli: o blur o effetto.
  - Male: `look: () => ({ samples: 8, effects: [zoomBlur({ amount: 40 })] })`
  - Bene: `look: () => ({ samples: 1, effects: [zoomBlur({ amount: 40 })] })`
- **`zoomBlur` misura il centro UV con y dal basso**: il punto (x, y) in pixel è `[x / W, 1 - y / H]`.
- **WebGL dentro la Lens solo con `LensThreeCanvas`** (`@/framework/three/LensThreeCanvas`): con un `<ThreeCanvas>` diretto Chrome riusa l'immagine registrata del canvas e R3F disegna dopo il paint, quindi in una stessa tab ogni frame ripete la prima immagine 3D. `pnpm cuts` non lo vede (un frame per tab), `pnpm stills --range` e il render sì. La scena gira a samples 1 (ogni campione clonerebbe il contesto GL) e va dichiarata in `webgl` del `look.ts`.
- **La cattura HTML-in-canvas della Lens può perdere contenuti solo nel render completo**: è già successo che disegnasse un elemento nell'angolo per qualche fotogramma, o lasciasse a schermo un solo elemento per dieci fotogrammi, mentre `pnpm stills` sugli stessi frame era corretto. Un video che non usa motion blur, grana o effetti WebGL non monta la Lens (in `Video.tsx` le scene vanno direttamente in un `AbsoluteFill`, senza `<Lens>`); uno che la usa va controllato sull'mp4 fotogramma per fotogramma (`pnpm flicker`, che `pnpm render` esegue da solo), non sui contact sheet.
- **HUD e `<Audio>` fuori dalla Lens**: dentro, lo zoom blur sbava l'HUD e i campioni duplicano l'audio.
- **Verifica visiva prima di dire fatto**: `pnpm stills <video>-<scena> --every=4` e guarda il contact sheet in `out/<video>/stills/`.
