.PHONY: test build install deploy deploy-vsce deploy-ovsx clean

test:
	node --test src/sharedStore.test.js


# Build the extension into a .vsix package
build: clean
	@echo "Packaging extension..."
	npx --yes @vscode/vsce package

# Install into Codium (all local profiles) and Cursor.
# Do not use `code` here: on this machine it is aliased to codium only.
install: build
	@vsix=$$(ls -t snapswitch-vscode-*.vsix | head -1); \
	echo "Installing $$vsix"; \
	if command -v codium >/dev/null 2>&1; then \
		codium --install-extension "$$vsix" --force; \
		python3 -c "import json,pathlib; p=pathlib.Path.home()/'Library/Application Support/VSCodium/User/globalStorage/storage.json';\
print('\n'.join(x.get('name','') for x in json.loads(p.read_text()).get('userDataProfiles',[]) if x.get('name')))" 2>/dev/null \
		| while read -r p; do \
			[ -n "$$p" ] || continue; \
			codium --install-extension "$$vsix" --force --profile "$$p" || true; \
		done; \
	fi; \
	if [ -x /Applications/Cursor.app/Contents/Resources/app/bin/cursor ]; then \
		/Applications/Cursor.app/Contents/Resources/app/bin/cursor --install-extension "$$vsix" --force; \
	fi

# Deploy to both Microsoft VS Marketplace and OpenVSX
deploy: build deploy-vsce deploy-ovsx
	@echo "Successfully deployed to all marketplaces!"

# Deploy to Microsoft VS Marketplace
deploy-vsce:
	@echo "Publishing to VS Code Marketplace..."
	npx --yes @vscode/vsce publish

# Deploy to Open VSX Registry
deploy-ovsx:
	@echo "Publishing to Open VSX Registry..."
	npx --yes ovsx publish

# Remove any generated packaged files
clean:
	@echo "Cleaning old builds..."
	rm -f *.vsix
