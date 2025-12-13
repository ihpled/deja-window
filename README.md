# **Deja Window**

**Deja Window** is a GNOME Shell extension that gives you full control over your window geometry. It automatically restores the size, position, and maximized state of specific applications when they open.

Originally designed to fix window restoration issues with modern terminals (like Ghostty) on GNOME/Wayland, it has evolved into a general-purpose window state manager.

## **🚀 Features**

* **Persistent Layouts**: Remembers the last known position and dimensions of your windows.  
* **Granular Control**: Configure specific rules per application (via WM\_CLASS).  
* **Flexible Matching**: Supports standard string matching and **Regular Expressions** (Regex) for advanced targeting.  
* **Modular Restoration**: Choose to restore size, position, and maximized state independently for each app.  
* **Smart Centering**: Automatically centers windows that are configured but haven't been saved yet.  
* **Wayland Ready**: Handles the specific timing constraints of window management on Wayland.

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

1. **Add New Application**:  
   * Enter the WM\_CLASS of the application you want to manage.  
   * You can find the class name in the dropdown (the extension auto-discovers running apps) or by using Alt+F2 and typing lg (Looking Glass) \> Windows.  
   * Example: com.mitchellh.ghostty or org.gnome.TextEditor.  
2. **Regex Mode**:  
   * Check "Regex" if you want to match multiple windows with a pattern.  
   * Example: .\*ghostty.\* will match any window class containing "ghostty".  
3. **Toggles**:  
   * **Restore Size**: App will open with the dimensions it had when last closed.  
   * **Restore Position**: App will open at the exact X/Y coordinates it had when last closed.  
   * **Restore Maximized**: App will open maximized if it was closed in that state.

## **🛠 Troubleshooting**

**Why isn't my window restoring?**

* Ensure the WM\_CLASS is correct.  
* On Wayland, some applications may override GNOME's positioning hints during their own startup phase. Deja Window uses a delay mechanism to enforce your settings, but extremely slow apps might need a retry.

**How do I reset the saved positions?**

* Currently, you can remove the configuration for the specific app in the settings and re-add it, or use dconf to clear the window-app-states key.

## **📄 License**

Distributed under the GPL-3.0 License. See LICENSE for more information.