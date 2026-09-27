# DopeCode — AI Harness Hackathon 2026 submission
#
#   export AI_API_KEY="<provided-key>"
#   make setup      # installs bun/ripgrep if missing, installs deps, builds dist/cli.mjs
#   make run        # launches the TUI (make run DIR=/path/to/repo to work in another checkout)
#   make test       # runs the test suite
#   make clean      # removes dist/ and node_modules/
#   make install    # puts a `dope` command on your PATH (BIN_DIR, default ~/.local/bin)
#
# AI_API_KEY is the only credential and is read from the environment; no key is
# hard-coded anywhere in this repository, and it is never echoed.
# Model configuration: see README "Model configuration" (defaults live in
# src/services/api/providerConfig.ts). Optional overrides, all from the environment:
#   AI_PROVIDER=deepseek|qwen|openrouter|openai|openai-compatible  AI_MODEL=<id>  AI_BASE_URL=<url>

BUN_VERSION := 1.4.2
# bun installs to ~/.bun/bin (or $BUN_INSTALL/bin); put it on PATH for every recipe and child process.
export PATH := $(or $(BUN_INSTALL),$(HOME)/.bun)/bin:$(PATH)
SUDO := $(shell [ "$$(id -u)" = 0 ] || echo sudo -n)
DIR ?= $(CURDIR)
BIN_DIR ?= $(HOME)/.local/bin

.PHONY: setup run test clean install uninstall

setup:
	@echo "Setting up DopeCode..."
	@command -v git >/dev/null 2>&1 || { echo "ERROR: git is required. Install git, then re-run 'make setup'."; exit 1; }
	@command -v bun >/dev/null 2>&1 || { echo "Installing bun $(BUN_VERSION) (https://bun.sh)..."; curl -fsSL https://bun.sh/install | bash -s "bun-v$(BUN_VERSION)"; }
	@# ponytail: package-manager install covers brew/apt/dnf/apk; anything else gets a warning, not a failed setup
	@command -v rg >/dev/null 2>&1 || { echo "Installing ripgrep (used by the Grep/Glob tools)..."; \
	  { brew install ripgrep || { $(SUDO) apt-get update -qq && $(SUDO) apt-get install -y -qq ripgrep; } \
	    || $(SUDO) dnf install -y ripgrep || $(SUDO) apk add --no-cache ripgrep; } >/dev/null 2>&1 \
	  || echo "WARNING: could not install ripgrep automatically. Grep/Glob need it: 'brew install ripgrep' or 'apt-get install ripgrep'."; }
	bun install
	bun run build
	@echo "Setup complete. Start the harness with: make run"

run:
	@test -f dist/cli.mjs || { echo "ERROR: not built yet. Run 'make setup' first."; exit 1; }
	@test -n "$$AI_API_KEY" || echo "Note: AI_API_KEY is not set. Export it, or add a key in the web command center (/web)."
	@echo "Starting DopeCode (AI Harness) in $(DIR)..."
	@cd "$(DIR)" && bun "$(CURDIR)/dist/cli.mjs"

test:
	@echo "Running tests..."
	bun test
	@test -f dist/cli.mjs || bun run build
	@bun dist/cli.mjs --version >/dev/null && echo "CLI smoke check: ok"

clean:
	@echo "Removing generated artefacts..."
	rm -rf dist node_modules

install:
	@test -f dist/cli.mjs || { echo "ERROR: not built yet. Run 'make setup' first."; exit 1; }
	@mkdir -p "$(BIN_DIR)"
	@ln -sf "$(CURDIR)/dist/cli.mjs" "$(BIN_DIR)/dope"
	@echo "Installed: $(BIN_DIR)/dope -> $(CURDIR)/dist/cli.mjs"
	@case ":$$PATH:" in *":$(BIN_DIR):"*) ;; *) echo "Add it to your PATH:  echo 'export PATH=\"$(BIN_DIR):\$$PATH\"' >> ~/.zshrc  (or ~/.bashrc)";; esac

uninstall:
	rm -f "$(BIN_DIR)/dope"
