# DopeCode — AI Harness Hackathon 2026 submission
#
#   export AI_API_KEY="<provided-key>"
#   make setup      # installs bun >= 1.4.2 and ripgrep if missing, installs deps, builds dist/cli.mjs
#   make run        # launches the TUI (make run DIR=/path/to/repo to work in another checkout)
#   make test       # runs the test suite
#   make clean      # removes dist/, node_modules/ and .bin/
#   make install    # puts a `dope` command on your PATH (BIN_DIR, default ~/.local/bin)
#
# AI_API_KEY is the only credential and is read from the environment; no key is
# hard-coded anywhere in this repository, and it is never echoed.
# Model configuration: see README "Model configuration" (defaults live in
# src/services/api/providerConfig.ts). Optional overrides, all from the environment:
#   AI_PROVIDER=deepseek|qwen|openrouter|openai|openai-compatible  AI_MODEL=<id>  AI_BASE_URL=<url>

BUN_VERSION := 1.4.2
RG_VERSION := 14.1.1
# bun installs to ~/.bun/bin (or $BUN_INSTALL/bin); a downloaded ripgrep lands in .bin/.
# Put both on PATH for every recipe and child process (the agent's Grep/Glob tools run `rg`).
# Recipe lines that call bun always contain `&&`/`||` so they run through the shell: make 3.81 (the macOS default)
# looks up a bare command on its own startup PATH, not this one, and would miss a freshly installed bun.
BUN_BIN := $(or $(BUN_INSTALL),$(HOME)/.bun)/bin
export PATH := $(BUN_BIN):$(CURDIR)/.bin:$(PATH)
SUDO := $(shell [ "$$(id -u)" = 0 ] || echo sudo -n)
# true when `bun` on PATH is at least $(BUN_VERSION) (sort -t. -kN,Nn works on GNU, BSD and busybox)
BUN_OK = v=$$(bun --version 2>/dev/null) && [ "$$(printf '%s\n' $(BUN_VERSION) "$$v" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = $(BUN_VERSION) ]
# ponytail: brew/apt/dnf/apk only; when none works (no root, no passwordless sudo) callers fall back to a download
pkg_install = { brew install $(1) || { $(SUDO) apt-get update -qq && $(SUDO) apt-get install -y -qq $(1); } \
	|| $(SUDO) dnf install -y $(1) || $(SUDO) apk add --no-cache $(1); } >/dev/null 2>&1
DIR ?= $(CURDIR)
BIN_DIR ?= $(HOME)/.local/bin

.PHONY: setup run test clean install uninstall

setup:
	@echo "Setting up DopeCode..."
	@command -v git >/dev/null 2>&1 || { echo "ERROR: git is required. Install git, then re-run 'make setup'."; exit 1; }
	@command -v curl >/dev/null 2>&1 || { echo "Installing curl..."; $(call pkg_install,curl); } \
	  || { echo "ERROR: curl is required. Install curl, then re-run 'make setup'."; exit 1; }
	@# bun's official installer needs unzip; if unzip can't be installed, take the same binary from its npm package.
	@$(BUN_OK) || { echo "Installing bun $(BUN_VERSION) to $(BUN_BIN)..."; \
	  command -v unzip >/dev/null 2>&1 || { echo "Installing unzip (needed by the bun installer)..."; $(call pkg_install,unzip); } || true; \
	  if command -v unzip >/dev/null 2>&1; then curl -fsSL https://bun.sh/install | bash -s "bun-v$(BUN_VERSION)"; else \
	    echo "unzip unavailable: downloading bun from registry.npmjs.org instead..."; \
	    os=$$(uname -s | tr A-Z a-z); case $$(uname -m) in x86_64|amd64) arch=x64;; *) arch=aarch64;; esac; \
	    { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; } && arch=$$arch-musl; \
	    mkdir -p "$(BUN_BIN)" && curl -fsSL "https://registry.npmjs.org/@oven/bun-$$os-$$arch/-/bun-$$os-$$arch-$(BUN_VERSION).tgz" \
	      | tar -xz -C "$(BUN_BIN)" --strip-components=2 package/bin/bun; fi; }
	@$(BUN_OK) || { echo "ERROR: could not install bun >= $(BUN_VERSION). Install it from https://bun.sh, then re-run 'make setup'."; exit 1; }
	@command -v rg >/dev/null 2>&1 || { echo "Installing ripgrep (used by the Grep/Glob tools)..."; $(call pkg_install,ripgrep) || { \
	  echo "No usable package manager: downloading ripgrep $(RG_VERSION) to .bin/ instead..."; \
	  case $$(uname -s)-$$(uname -m) in Linux-x86_64) t=x86_64-unknown-linux-musl;; Linux-aarch64) t=aarch64-unknown-linux-gnu;; \
	    Darwin-x86_64) t=x86_64-apple-darwin;; Darwin-arm64) t=aarch64-apple-darwin;; esac; \
	  mkdir -p .bin && curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/$(RG_VERSION)/ripgrep-$(RG_VERSION)-$$t.tar.gz" \
	    | tar -xz -C .bin --strip-components=1 "ripgrep-$(RG_VERSION)-$$t/rg"; \
	  .bin/rg --version >/dev/null 2>&1 || { rm -f .bin/rg; \
	    echo "WARNING: could not install ripgrep automatically. Grep/Glob need it: 'brew install ripgrep' or 'apt-get install ripgrep'."; }; }; }
	bun install && bun run build
	@echo "Setup complete. Start the harness with: make run   (to work on another repo: make run DIR=/path/to/repo)"

run:
	@test -f dist/cli.mjs || { echo "ERROR: not built yet. Run 'make setup' first."; exit 1; }
	@test -n "$$AI_API_KEY" || echo "Note: AI_API_KEY is not set. Export it, or add a key in the web command center (/web)."
	@echo "Starting DopeCode (AI Harness) in $(DIR)  (to work on another repo: make run DIR=/path/to/repo)"
	@cd "$(DIR)" && bun "$(CURDIR)/dist/cli.mjs"

test:
	@echo "Running tests..." && bun test
	@test -f dist/cli.mjs || bun run build
	@bun dist/cli.mjs --version >/dev/null && echo "CLI smoke check: ok"

clean:
	@echo "Removing generated artefacts..."
	rm -rf dist node_modules .bin

install:
	@test -f dist/cli.mjs || { echo "ERROR: not built yet. Run 'make setup' first."; exit 1; }
	@mkdir -p "$(BIN_DIR)"
	@ln -sf "$(CURDIR)/dist/cli.mjs" "$(BIN_DIR)/dope"
	@echo "Installed: $(BIN_DIR)/dope -> $(CURDIR)/dist/cli.mjs"
	@case ":$$PATH:" in *":$(BIN_DIR):"*) ;; *) echo "Add it to your PATH:  echo 'export PATH=\"$(BIN_DIR):\$$PATH\"' >> ~/.zshrc  (or ~/.bashrc)";; esac

uninstall:
	rm -f "$(BIN_DIR)/dope"
