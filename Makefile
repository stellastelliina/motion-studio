.DEFAULT_GOAL := help

VIDEO ?=

# No target is a file: without this, `make build` is a no-op once build/ exists.
.PHONY: help install dev audio stills cuts render render-draft new-video test lint format typecheck template build check clean

help: ## Mostra questo help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Verifica i prerequisiti, scarica i riferimenti (Git LFS) e installa le dipendenze
	@command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { echo "Manca ffmpeg: brew install ffmpeg"; exit 1; }
	@command -v git-lfs >/dev/null || { echo "Manca git-lfs: brew install git-lfs"; exit 1; }
	git lfs install --local
	git lfs pull
	pnpm install

dev: ## Rigenera le colonne sonore e apre Remotion Studio (porta 4450)
	pnpm dev

audio: ## Rigenera la colonna sonora (VIDEO=<id>, vuoto = tutte)
	pnpm audio $(VIDEO)

stills: ## Contact sheet per la QA visiva (VIDEO=, ARGS="--every=6")
	pnpm stills $(VIDEO) $(ARGS)

cuts: ## Verifica dei raccordi tra scene: SSIM e foglio dei tagli (VIDEO=)
	pnpm cuts $(VIDEO)

render: ## Render finale in out/ (VIDEO=, ARGS="--prores")
	pnpm render $(VIDEO) $(ARGS)

render-draft: ## Render veloce a metà risoluzione (VIDEO=)
	pnpm render $(VIDEO) --draft

new-video: ## Crea un video dal template (ID=, TITLE=, FORMAT=landscape|vertical|square)
	@test -n "$(ID)" || (echo "Uso: make new-video ID=nome-video [TITLE=...] [FORMAT=...]" && exit 1)
	pnpm new-video $(ID) $(if $(TITLE),--title="$(TITLE)") $(if $(FORMAT),--format=$(FORMAT))

test: ## Test delle parti pure del framework (griglia, storyboard, tween, voce, audio)
	pnpm test

lint: ## ESLint
	pnpm lint

format: ## Prettier su tutto il progetto
	pnpm format

typecheck: ## TypeScript strict
	pnpm typecheck

template: ## Typecheck e lint di ciò che genera new-video (il template scaffoldato in out/)
	pnpm check-template

build: ## Bundle di Remotion (verifica che il progetto compili per il render)
	pnpm build

check: ## Giro completo: format, lint, typecheck, template, test, build
	$(MAKE) format
	$(MAKE) lint
	$(MAKE) typecheck
	$(MAKE) template
	$(MAKE) test
	$(MAKE) build

clean: ## Cancella il generato non versionato (build/, out/template-check/)
	rm -rf build out/template-check
