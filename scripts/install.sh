#!/bin/bash

# Configuration
UUID="deja-window@mcast.gnomext.com"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src"

# deja-window.png is excluded on purpose: it's the full-color logo used only
# for the extensions.gnome.org listing, not loaded by the extension at runtime.
FILES_TO_INSTALL="extension.js prefs.js windowMenu.js metadata.json schemas"
ICON_FILES="icons/deja-window-symbolic.png icons/globe-symbolic.svg"
ZIP_MODE=false

# Check for --zip argument
if [[ "$1" == "--zip" ]]; then
    ZIP_MODE=true
fi

echo "🚧 Building and Installing Gnomelets Extension..."

# 1. Compile Schemas
echo "⚙️ Compiling schemas..."
glib-compile-schemas "$SRC_DIR/schemas/"

# Move to source directory to simplify file operations
cd "$SRC_DIR" || exit

if [ "$ZIP_MODE" = true ]; then
    # Create temp directory
    mkdir -p "$PROJECT_ROOT/temp"
    ZIP_FILE="$PROJECT_ROOT/temp/${UUID}.zip"

    # Create zip archive
    echo "🤐 Creating zip package: $ZIP_FILE"
    rm -f "$ZIP_FILE"
    zip -r "$ZIP_FILE" $FILES_TO_INSTALL $ICON_FILES

    echo "✅ Package created successfully!"
else
    # 2. Create directory if it doesn't exist
    if [ ! -d "$INSTALL_DIR" ]; then
        echo "📂 Creating install directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi

    # 3. Copy files
    echo "📦 Copying files to $INSTALL_DIR..."
    cp -r $FILES_TO_INSTALL "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/icons"
    cp $ICON_FILES "$INSTALL_DIR/icons/"

    # 4. Success message
    echo "✅ Installation complete!"
    echo "🔄 Please restart GNOME Shell (Alt+F2, then 'r' on X11, or Log Out/In on Wayland) to see changes."
fi
