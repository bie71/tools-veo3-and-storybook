SHELL := bash

# Package manager (override with `make PM=pnpm` or `yarn` if needed)
PM ?= npm

# Server options (override via `make dev VITE_PORT=3000`)
VITE_HOST ?= 127.0.0.1
VITE_PORT ?= 5173
PREVIEW_PORT ?= 4173

.PHONY: help install dev build preview typecheck clean

help:
	@echo "Make targets:"
	@echo "  install     Install dependencies (uses $$PM, default npm)"
	@echo "  dev         Run Vite dev server (host/port configurable)"
	@echo "  build       Build production bundle"
	@echo "  preview     Preview built app (host/port configurable)"
	@echo "  typecheck   Run TypeScript type checking"
	@echo "  clean       Remove build artifacts (dist)"

install:
	@echo "Installing dependencies with $(PM)..."
	@$(PM) ci || $(PM) install

dev:
	$(PM) run dev -- --host $(VITE_HOST) --port $(VITE_PORT)

build:
	$(PM) run build

preview:
	$(PM) run preview -- --host $(VITE_HOST) --port $(PREVIEW_PORT)

typecheck:
	npx tsc --noEmit

clean:
	rm -rf dist

