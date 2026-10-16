.PHONY: test check build install clean

# Honor NO_COLOR when both color flags are inherited from the terminal.
ifneq ($(NO_COLOR),)
unexport FORCE_COLOR
endif

test:
	pnpm test

check:
	pnpm run check

# Build the extension into a .vsix package
build:
	@echo "Packaging extension..."
	pnpm run package

# Install into VSCodium (all local profiles).
# Do not use `code` here: on this machine it is aliased to codium only.
install: build
	@set -e; \
	vsix=$$(node -p "require('./package.json').name + '-' + require('./package.json').version + '.vsix'"); \
	echo "Installing $$vsix"; \
	if command -v codium >/dev/null 2>&1; then \
		echo "VSCodium: default profile"; \
		codium --install-extension "$$vsix" --force; \
		python3 -c "import json,pathlib; p=pathlib.Path.home()/'Library/Application Support/VSCodium/User/globalStorage/storage.json';\
print('\n'.join(x.get('name','') for x in json.loads(p.read_text()).get('userDataProfiles',[]) if x.get('name')))" 2>/dev/null \
		| while read -r p; do \
			[ -n "$$p" ] || continue; \
			echo "VSCodium profile: $$p"; \
			codium --install-extension "$$vsix" --force --profile "$$p"; \
		done; \
	fi

# Remove compiled output and local extension packages
clean:
	@echo "Cleaning old builds..."
	rm -f *.vsix
	rm -rf out
