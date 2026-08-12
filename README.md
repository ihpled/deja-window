# **Deja Window**

**Deja Window** is a GNOME Shell extension that gives you full control over your window geometry. It automatically restores the workspace, size, position, minimized and maximized state, always on top and always on visible workspace of specific applications when they open.

## **🤔 Why Deja Window?**

In "vanilla" GNOME, windows typically open in the current workspace either centered or in a upper-left layout. This behavior stems from two main factors:

1. **GNOME's Philosophy**: The design dictates that the Window Manager (Mutter) should control window placement to avoid off-screen windows or chaotic overlaps, rather than letting individual apps decide.  
2. **Wayland Constraints**: For security and isolation, the Wayland protocol does not natively allow applications to know their absolute global coordinates on the screen. This makes it technically impossible for most apps to "remember" and restore their own position after closing.

**Deja Window** bridges this gap by acting as an external memory for your window layout, forcing the desired position, size and states that the OS or the apps themselves cannot natively restore. Deja Window is also very useful for all those applications (such as Ghostty) that do not adequately manage the layout of their windows in Gnome.

## **🚀 Features**

* **Persistent Layouts**: Remembers the last known position, size (included workspace) and states (minimized and maximized, always on top and always on visible workspace) of your windows.  
* **Granular Control**: Configure specific rules per application (via WM_CLASS or Window Title).  
* **Flexible Matching**: Supports standard string matching and **Regular Expressions** (Regex) for advanced targeting.  
* **Modular Restoration**: Choose to restore workspace, size, position, minimized and maximized state, always on top and always on visible workspace, independently for each app.  
* **Multi-Monitor Support**: Automatically detects and restores windows to the exact monitor they were previously saved on.
* **Layout Locking**: Freeze a window's saved layout to maintain your perfect configuration, preventing accidental updates when temporarily moving or resizing windows.
* **Smart Centering**: Automatically centers windows that are configured but haven't been saved yet.  
* **Global Defaults (Experimental)**: Optionally manage every normal window that doesn't already have its own rule, with independent restore toggles and its own exclude list for apps that should never be touched by it.
* **Window Menu Quick Actions**: Right-click a window's title bar (or press Super+Space) for a "Deja Window" submenu to manage it by class or title, exclude it, or jump straight to its rule in Preferences.
* **Non-Destructive Rule Toggling**: Turn a rule off — from Preferences or from the window menu — without deleting it. Its customization is kept and restored the moment you turn it back on.
* **Top Bar Indicator**: An optional icon in the top bar for quick access to Preferences and to pause/resume Deja Window without disabling the extension itself.
* **Wayland Ready**: Handles the specific timing constraints of window management on Wayland.

**Compatibility Note**: While this extension works with the majority of standard applications, some apps utilize custom layout mechanisms or non-standard toolkits that may override or ignore the extension's positioning attempts.

## **📦 Installation**

### **From Source**

1. Clone this repository:  
   git clone \[https://github.com/ihpled/deja-window.git\](https://github.com/ihpled/deja-window.git)

2. Move to the extension directory:  
   cd deja-window

3. Install the extension:  
   \# Create the directory if it doesn't exist    
   mkdir \-p \~/.local/share/gnome-shell/extensions/deja-window@mcast.gnomext.com

   \# Copy files    
   cp \-r \* \~/.local/share/gnome-shell/extensions/deja-window@mcast.gnomext.com/

4. Log out and log back in (or restart GNOME Shell on X11 with Alt+F2, then r).  
5. Enable the extension using **GNOME Extensions** or **Extension Manager**.

## **⚙️ Configuration**

Open the extension preferences to start managing your windows. Preferences are organized into three tabs: **Applications** (per-app rules), **Global Defaults** (experimental, opt-in defaults for everything else) and **Settings** (top bar indicator and the master Enabled switch).

### **Applications tab**

1. **Add New Windows**:  
   * Enter the WM_CLASS or Window Title of the window you want to manage.  
   * You can find the class name or title in the dropdown (the extension auto-discovers running apps) or by using Alt+F2 and typing lg (Looking Glass) > Windows.  
   * Example: com.mitchellh.ghostty or org.gnome.TextEditor.  
2. **Regex Mode**:  
   * Check "Regex" if you want to match multiple windows with a pattern.  
   * Example: WM_CLASS mode with .\*ghostty.\* will match any window class containing "ghostty", Window Title mode with ^DevTools.\* will match Chrome DevTools window.  
3. **Toggles**:  
   * **Locked**: Freezes the currently saved layout, preventing window updates or changes from being saved. While it's on, the save button next to it snapshots the app's current window (position, size, monitor, workspace and states) as that fixed layout right away (you don't have to unlock, arrange the window, wait for the automatic save and lock again).
   * **Restore Size**: App will open with the dimensions it had when last closed.  
   * **Restore Position**: App will open at the exact X/Y coordinates it had when last closed (includes restoring to the correct monitor in multi-display setups).  
   * **Restore Maximized**: App will open maximized if it was closed in that state.  
   * **Restore Workspace**: App will open on the workspace it was last closed on.  
   * **Switch to Workspace**: When the app opens, the desktop will automatically switch to that workspace.  
   * **Restore Minimized**: App will open minimized if it was closed in that state.  
   * **Restore Always on Top**: App will maintain its "Always on Top" status.  
   * **Restore Always on Visible Workspace**: App will maintain its "Always on Visible Workspace" (sticky) status.
   * **Avoid Overlap for Additional Windows**: If another window of this app is already sitting at the restored position, offsets this one diagonally so it doesn't land exactly on top of it. On by default.
4. **Enabling/Disabling a Rule**: Each rule has its own switch, separate from the delete button. Turning it off has the same effect as removing it — the window is left unmanaged — but its customization is kept and comes right back when you turn it back on.

### **Global Defaults tab (Experimental)**

Rules applied automatically to every *normal* window that doesn't already match a rule in the Applications tab. Explicit per-app rules always take priority.

* Has the same toggles as a per-app rule, minus **Locked**: pinning one fixed layout for every app that has no rule of its own isn't meaningful.
* Turning it on is gated behind a confirmation dialog, since it changes the risk model for every installed app at once rather than one app you've already tested.
* **Excluded Apps**: WM_CLASS values that should never be touched by Global Defaults, even while it's enabled.

### **Settings tab**

* **Enabled**: The master switch for Deja Window. When off, the extension stays installed and active but all window tracking, restoring and saving is bypassed.
* **Show Icon in Top Bar**: Adds an indicator to the top bar with quick access to Preferences and to the Enabled switch above.

## **🖱️ Window Menu Quick Actions**

Right-click a window's title bar (or press Super+Space) to open GNOME's window menu. Deja Window adds a **"Deja Window"** submenu there for quick, per-window changes without having to open Preferences:

* **Managed by Window Class** / **Managed by Window Title**: creates (or re-enables) a rule matching this window's WM_CLASS or title, with every restore option turned on by default. The two are mutually exclusive for a given window — picking one turns off the other.
* **Customize**: jumps straight to Preferences with that rule expanded, ready to fine-tune.
* **Unmanaged**: turns off whichever rule currently governs this window, without deleting it. Shown as **"Unmanaged (Global Defaults)"** when Global Defaults is enabled, since the window will still be managed by it.
* **Excluded**: turns off the window's rule and adds its WM_CLASS to the Global Defaults exclude list, so it stays untouched even if Global Defaults is enabled.

As with the Applications tab's per-rule switch, none of these actions delete a rule — they only turn it on or off, so switching back restores any customization you'd already made.

## **🛠 Troubleshooting**

**Why isn't my window restoring?**

* **Check the WM_CLASS/Title**: Ensure it matches exactly (or your Regex is correct).  
* **Wayland Timing**: On Wayland, some applications may override GNOME's positioning hints during their own startup phase. Deja Window uses a delay mechanism to enforce your settings, but extremely slow apps might need a retry.  
* **Custom Layouts**: Some applications (like certain IDEs or games) enforce their own window management logic that fights against the Window Manager. In these rare cases, the extension might not be able to force the position.
* **Auto-maximization issue**: Sometimes, when opening large applications, the window will be automatically maximized without gaps. This might be due to a setting in Gnome which is adjustable using the dconf editor:
/org/gnome/mutter/auto-maximize (defaults is true. If you're experiencing this issue, try setting this to false)
The description for the setting is "Auto maximize nearly monitor sized windows". If enabled, new windows that are initially nearly the size of the monitor automatically get maximized.

**How do I reset the saved positions?**

* Currently, you can remove the configuration for the specific app in the settings and re-add it, or use dconf/gsettings to clear the window-app-states key.

## **📄 License**

Distributed under the GPL-3.0 License. See LICENSE for more information.