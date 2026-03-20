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

Open the extension preferences to start managing your windows.

1. **Add New Windows**:  
   * Enter the WM_CLASS or Window Title of the window you want to manage.  
   * You can find the class name or title in the dropdown (the extension auto-discovers running apps) or by using Alt+F2 and typing lg (Looking Glass) > Windows.  
   * Example: com.mitchellh.ghostty or org.gnome.TextEditor.  
2. **Regex Mode**:  
   * Check "Regex" if you want to match multiple windows with a pattern.  
   * Example: WM_CLASS mode with .\*ghostty.\* will match any window class containing "ghostty", Window Title mode with ^DevTools.\* will match Chrome DevTools window.  
3. **Toggles**:  
   * **Locked**: Freezes the currently saved layout, preventing window updates or changes from being saved.
   * **Restore Size**: App will open with the dimensions it had when last closed.  
   * **Restore Position**: App will open at the exact X/Y coordinates it had when last closed (includes restoring to the correct monitor in multi-display setups).  
   * **Restore Maximized**: App will open maximized if it was closed in that state.  
   * **Restore Workspace**: App will open on the workspace it was last closed on.  
   * **Switch to Workspace**: When the app opens, the desktop will automatically switch to that workspace.  
   * **Restore Minimized**: App will open minimized if it was closed in that state.  
   * **Restore Always on Top**: App will maintain its "Always on Top" status.  
   * **Restore Always on Visible Workspace**: App will maintain its "Always on Visible Workspace" (sticky) status.

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