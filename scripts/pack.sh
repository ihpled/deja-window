#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src"
ZIP_NAME="$PROJECT_ROOT/temp/deja-window.zip"

# Create temp directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/temp"

# Remove existing zip if it exists
if [ -f "$ZIP_NAME" ]; then
    rm "$ZIP_NAME"
fi

echo "📦 Packaging from $SRC_DIR..."

# Zip the extension files from src
# -r: recurse into directories
cd "$SRC_DIR" || exit
# deja-window.png is excluded on purpose: it's the full-color logo used only
# for the extensions.gnome.org listing, not loaded by the extension at runtime.
zip -r "$ZIP_NAME" extension.js \
    metadata.json \
    prefs.js \
    schemas/org.gnome.shell.extensions.deja-window.gschema.xml \
    icons/deja-window-symbolic.png \
    icons/globe-symbolic.svg

# Add README.md from root
echo "📄 Adding README.md..."
cd "$PROJECT_ROOT" || exit
zip -g "$ZIP_NAME" README.md

echo "✅ Created $ZIP_NAME"

