import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { DejaWindowMenu } from './windowMenu.js';

const DEBUG = false;

function debug(...args) {
    if (DEBUG) console.log(...args);
}

/**
 * DejaWindowExtension Class
 * The main class for the "Deja Window" extension.
 * This extension allows users to manage the size, position, and maximized state
 * of application windows. It supports:
 * - Saving and restoring window dimensions and position per WM_CLASS.
 * - Restoring maximized state.
 * - Restoring workspace (desktop).
 * - Restoring minimized state.
 * - Restoring always on top state.
 * - Restoring always on visible workspace (sticky) state.
 * - Regex-based matching for WM_CLASS.
 * - Automatic centering of windows if no saved state exists.
 * - Live monitoring of window creation and geometry changes.
 * - Refactored to use connectObject/disconnectObject for cleaner signal management.
 */
export default class DejaWindowExtension extends Extension {
    enable() {
        // Initialize settings from schema
        this._settings = this.getSettings();

        // Map<Window, { timeoutId: number, wsTimeoutId: number, isRestoreApplied: boolean, actors: Meta.WindowActor[] }>
        this._handles = new Map();

        // Cache for configurations to avoid parsing JSON on every window creation
        this._configs = [];
        this._globalDefaults = {};
        this._updateConfigs();
        this._updateGlobalDefaults();

        // Logical bypass switch (top bar indicator menu): when false, the
        // extension stays enabled but all tracking/restore/save is a no-op.
        this._functionalityEnabled = this._settings.get_boolean('functionality-enabled');
        this._settings.connectObject('changed::functionality-enabled', () => {
            this._functionalityEnabled = this._settings.get_boolean('functionality-enabled');
            if (this._functionalityEnabled) {
                // Windows opened while bypassed were never adopted; pick them up now.
                this._adoptUnmanagedWindows();
            }
        }, this);

        // Listen for config changes using connectObject. As with Global Defaults
        // below, a config change (e.g. rules added via the prefs Import feature)
        // can newly qualify already-open windows, so adopt those too instead of
        // only applying to windows opened from now on.
        this._settings.connectObject('changed::window-app-configs', () => {
            this._updateConfigs();
            this._adoptUnmanagedWindows();
        }, this);

        // Listen for Global Defaults changes. Unlike window-app-configs, a defaults
        // change can newly qualify already-open windows that were previously
        // unmanaged, so also adopt those instead of waiting for a reload.
        this._settings.connectObject('changed::window-global-defaults', () => {
            this._updateGlobalDefaults();
            this._adoptUnmanagedWindows();
        }, this);

        // Top bar indicator, shown/hidden per the show-indicator preference
        this._indicator = null;
        this._settings.connectObject('changed::show-indicator', () => {
            this._updateIndicator();
        }, this);
        this._updateIndicator();

        // Subscribe to the global 'window-created' event to detect new windows using connectObject
        global.display.connectObject('window-created', (display, window) => {
            this._onWindowCreated(window);
        }, this);

        // Handle already existing windows (Crucial for X11 and reload)
        // We use an idle callback to ensure the loop starts after full initialization
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            // Meta.TabList.NORMAL includes standard managed windows (filters out O-R windows usually)
            const windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
            for (const window of windows) {
                this._onWindowCreated(window);
            }
            return GLib.SOURCE_REMOVE;
        });

        // Initialize probes map
        this._probes = new Map();

        // "Deja Window" submenu injected into GNOME's window (title bar) menu
        this._windowMenu = new DejaWindowMenu(this);
        this._windowMenu.enable();
    }

    disable() {
        if (this._windowMenu) {
            this._windowMenu.disable();
            this._windowMenu = null;
        }

        // Clean up global signals associated with this extension
        if (this._settings) {
            this._settings.disconnectObject(this);
        }
        global.display.disconnectObject(this);

        this._destroyIndicator();

        // Clean up all managed windows
        for (const window of this._handles.keys()) {
            this._cleanupWindow(window);
        }
        this._handles.clear();

        // Clean up probes
        if (this._probes) {
            for (const [window, ids] of this._probes) {
                ids.forEach(id => {
                    window.disconnect(id);
                });
            }
            this._probes.clear();
        }

        this._settings = null;
        this._configs = [];
        this._globalDefaults = {};
        this._functionalityEnabled = true;
    }

    // --- TOP BAR INDICATOR ---

    _updateIndicator() {
        const show = this._settings.get_boolean('show-indicator');
        if (show) {
            this._createIndicator();
        } else {
            this._destroyIndicator();
        }
    }

    _createIndicator() {
        if (this._indicator) return;

        const indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        const iconPath = GLib.build_filenamev([this.path, 'icons', 'deja-window-symbolic.png']);
        indicator.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'system-status-icon'
        }));

        const settingsItem = new PopupMenu.PopupMenuItem('Deja Window Settings');
        settingsItem.connect('activate', () => this.openPreferences());
        indicator.menu.addMenuItem(settingsItem);

        indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Logical on/off switch: bypasses window tracking/restore/save without
        // actually disabling the extension, so the indicator and this menu
        // stay available to switch it back on.
        const enabledItem = new PopupMenu.PopupSwitchMenuItem('Enabled', this._functionalityEnabled);
        enabledItem.connect('toggled', (_item, state) => {
            this._settings.set_boolean('functionality-enabled', state);
        });
        this._settings.connectObject('changed::functionality-enabled', () => {
            enabledItem.setToggleState(this._settings.get_boolean('functionality-enabled'));
        }, indicator);
        indicator.menu.addMenuItem(enabledItem);

        Main.panel.addToStatusArea(this.uuid, indicator);
        this._indicator = indicator;
    }

    _destroyIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    // --- HELPER METHODS FOR API COMPATIBILITY ---

    _maximizeWindow(window) {
        // Feature detection: Check function arity (number of expected arguments)
        // Older Meta versions expect flags (length > 0), newer versions do not (length === 0).
        if (typeof window.maximize === 'function' && window.maximize.length > 0) {
            window.maximize(Meta.MaximizeFlags.BOTH);
        } else {
            window.maximize();
        }
    }

    _unmaximizeWindow(window) {
        // Feature detection: Check function arity (number of expected arguments)
        if (typeof window.unmaximize === 'function' && window.unmaximize.length > 0) {
            window.unmaximize(Meta.MaximizeFlags.BOTH);
        } else {
            window.unmaximize();
        }
    }

    // Helper to update configs from settings
    _updateConfigs() {
        try {
            const json = this._settings.get_string('window-app-configs');
            this._configs = JSON.parse(json) || [];
        } catch (e) {
            console.error('[DejaWindow] Error parsing window-app-configs:', e);
            this._configs = [];
        }

        this._cleanupStaleHandles();
    }

    // Helper to update Global Defaults from settings
    _updateGlobalDefaults() {
        try {
            const json = this._settings.get_string('window-global-defaults');
            this._globalDefaults = JSON.parse(json) || {};
        } catch (e) {
            console.error('[DejaWindow] Error parsing window-global-defaults:', e);
            this._globalDefaults = {};
        }

        this._cleanupStaleHandles();
    }

    // Tears down any managed window that no longer resolves to an explicit
    // config or Global Defaults (e.g. config removed, or excluded from defaults).
    _cleanupStaleHandles() {
        for (const [window, handle] of this._handles) {
            // Check validity before accessing props
            if (!window || !window.get_workspace()) continue;

            if (!this._getEffectiveConfig(window)) {
                debug(`[DejaWindow] No longer managing: ${window.get_wm_class()} / ${window.get_title()}`);
                this._cleanupWindow(window);
            }
        }
    }

    // Adopts any currently open, not-yet-managed windows. Used when Global
    // Defaults are enabled/edited at runtime, so already-open windows don't
    // require an extension reload to start being managed.
    _adoptUnmanagedWindows() {
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
        for (const window of windows) {
            if (this._handles.has(window)) continue;
            this._checkAndSetup(window);
        }
    }

    // Helper to find a matching config for a given Window
    _getConfigForWindow(window) {
        if (!window) return null;

        const wmClass = window.get_wm_class();
        const title = window.get_title();

        return this._configs.find(c => {
            // A disabled rule is treated as if it didn't exist: same effect as
            // deleting it, but its definition/customization is preserved.
            if (c.enabled === false) return false;

            const mode = c.match_mode || 'wm_class';
            let valueToCheck = wmClass;

            if (mode === 'title') {
                valueToCheck = title;
            }

            if (!valueToCheck) return false;

            if (c.is_regex) {
                return new RegExp(c.wm_class).test(valueToCheck);
            } else {
                return c.wm_class === valueToCheck;
            }
        });
    }

    // Resolves the config and identity that should govern a window: an explicit
    // per-app config always wins; otherwise, if Global Defaults are enabled, the
    // window is NORMAL, and its wm_class isn't excluded, fall back to the Global
    // Defaults object. Identity is always the window's own live wm_class in the
    // fallback case (never a fixed value on the defaults object itself), so each
    // app still gets its own slot in window-app-states instead of colliding.
    _getEffectiveConfig(window) {
        if (!window) return null;

        const explicit = this._getConfigForWindow(window);
        if (explicit) {
            return { config: explicit, identity: explicit.wm_class };
        }

        if (!this._globalDefaults.enabled) return null;
        if (window.get_window_type() !== Meta.WindowType.NORMAL) return null;

        const wmClass = window.get_wm_class();
        if (!wmClass) return null;
        if (this._isExcludedFromDefaults(window, wmClass)) return null;

        return { config: this._globalDefaults, identity: wmClass };
    }

    // Checks whether a window is excluded from Global Defaults via the
    // excluded_apps rules, which mirror per-app config matching (match_mode
    // 'wm_class'|'title', optional regex, 'wm_class' field holding the pattern).
    _isExcludedFromDefaults(window, wmClass) {
        const rules = this._globalDefaults.excluded_apps || [];
        if (rules.length === 0) return false;

        const title = window.get_title();
        return rules.some(rule => {
            const valueToCheck = (rule.match_mode === 'title') ? title : wmClass;
            if (!valueToCheck) return false;
            try {
                return rule.is_regex ? new RegExp(rule.wm_class).test(valueToCheck) : rule.wm_class === valueToCheck;
            } catch (e) {
                console.error(`[DejaWindow] Invalid regex in excluded_apps: ${rule.wm_class}`, e);
                return false;
            }
        });
    }

    // Helper to record a new WM_CLASS in the known-wm-classes setting
    _recordWmClass(wmClass) {
        if (!wmClass) return;
        let known = this._settings.get_value('known-wm-classes').recursiveUnpack();
        if (!known.includes(wmClass)) {
            known.push(wmClass);
            // Sort to look nice
            known.sort();
            this._settings.set_value('known-wm-classes', new GLib.Variant('as', known));
        }
    }

    // Helper to record a new window title in the known-window-titles setting
    // (feeds the prefs pickers when match_mode is 'title'). Capped because,
    // unlike WM_CLASSes, titles are unbounded (e.g. browser tab titles).
    _recordTitle(title) {
        if (!title) return;
        let known = this._settings.get_value('known-window-titles').recursiveUnpack();
        if (known.includes(title)) return;
        if (known.length >= 200) return;
        known.push(title);
        known.sort();
        this._settings.set_value('known-window-titles', new GLib.Variant('as', known));
    }

    // Helper to cleanup a window. Disconnects signals and removes timeout if pending.
    _cleanupWindow(window) {
        const handle = this._handles.get(window);
        if (!handle) return;

        // Remove timeout if pending
        if (handle.timeoutId) {
            GLib.source_remove(handle.timeoutId);
            handle.timeoutId = 0;
        }
        // Remove workspace timeout if pending
        if (handle.wsTimeoutId) {
            GLib.source_remove(handle.wsTimeoutId);
            handle.wsTimeoutId = 0;
        }

        // Disconnect all signals on the window associated with 'this' extension
        // This replaces the manual loop and try-catch blocks
        window.disconnectObject(this);

        // Disconnect any tracked actors
        handle.actors?.forEach(actor => {
            actor.disconnectObject(this);
        });

        this._handles.delete(window);
    }

    // Helper to check if a window is valid for management (NOT override_redirect)
    _isValidManagedWindow(window) {
        // Skip override_redirect windows (tooltips, dnd, menus, etc)
        // This prevents "assertion '!window->override_redirect' failed" errors
        if (window.is_override_redirect()) return false;

        // Optionally, ensure it is a normal window type (or Dialog/Utility if desired)
        // Meta.WindowType.NORMAL = 0
        const type = window.get_window_type();
        if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG && type !== Meta.WindowType.UTILITY) {
            return false;
        }
        return true;
    }

    // Helper to handle window creation. Records WM_CLASS and checks if we should manage the window.
    _onWindowCreated(window) {
        // First check: Is this a manage-able window?
        if (!this._isValidManagedWindow(window)) return;

        // If we're already handling this window, exit early.
        if (this._handles.has(window)) return;

        // Record class/title if available immediately
        if (window.get_wm_class()) {
            this._recordWmClass(window.get_wm_class());
        }
        if (window.get_title()) {
            this._recordTitle(window.get_title());
        }

        // Try to setup immediately
        if (this._checkAndSetup(window)) return;

        // If not matched yet, we listen for property changes (wm-class or title)
        // that might allow a match later (e.g. title is set after creation).
        this._attachProbe(window);
    }

    _attachProbe(window) {
        if (!this._probes) this._probes = new Map();
        if (this._probes.has(window)) return;

        const onPropChanged = () => {
            if (window.get_wm_class()) {
                this._recordWmClass(window.get_wm_class());
            }
            if (window.get_title()) {
                this._recordTitle(window.get_title());
            }

            if (this._checkAndSetup(window)) {
                // Window matched and setup! Remove probes.
                this._removeProbe(window);
            }
        };

        // We use manual connections to avoid conflict with connectObject('this') usage in managed state,
        // and to allow precise cleanup of just these listeners.
        const id1 = window.connect('notify::wm-class', onPropChanged);
        const id2 = window.connect('notify::title', onPropChanged);

        // Also listen for unmanaging to cleanup probes
        const id3 = window.connect('unmanaging', () => this._removeProbe(window));

        this._probes.set(window, [id1, id2, id3]);
    }

    _removeProbe(window) {
        if (!this._probes || !this._probes.has(window)) return;
        const ids = this._probes.get(window);
        ids.forEach(id => {
            window.disconnect(id);
        });
        this._probes.delete(window);
    }

    // Helper to check if we should manage a window. If so, sets up listeners.
    _checkAndSetup(window) {
        // Bypassed: skip adopting new windows entirely, no side effects.
        if (!this._functionalityEnabled) return false;

        // Double check validity before setup
        if (!this._isValidManagedWindow(window)) return false;

        // Check if we should manage this window (explicit config or Global Defaults)
        const effective = this._getEffectiveConfig(window);
        if (effective && effective.identity) {
            this._setupListeners(window, effective.identity);
            return true;
        }
        return false;
    }

    // Sets up specific listeners for configured windows to handle resizing, positioning, and saving state.
    _setupListeners(window, identity) {
        if (this._handles.has(window)) return;

        debug('[DejaWindow] Setup listeners for:', identity);

        const handle = {
            timeoutId: 0,               // Store timeout ID
            wsTimeoutId: 0,             // Store workspace timeout ID
            isRestoreApplied: false,    // Track if restore has been applied
            actors: []                  // Track actors to disconnectObject if window closes
        };
        this._handles.set(window, handle);

        // --- RESTORE LOGIC ---

        // Function to trigger restore. Safe to call multiple times (guarded by isRestoreApplied)
        const triggerRestore = () => {
            if (handle.isRestoreApplied) return;
            const effective = this._getEffectiveConfig(window);
            if (effective) {
                this._applySavedState(window, effective.identity, effective.config);
            }
        };

        // EVENT-DRIVEN READY CHECK
        // Instead of timers, we use the Window Actor state.
        const waitForActorMap = (actor) => {
            if (actor.mapped) {
                debug('[DejaWindow] Actor already mapped:', identity);
                triggerRestore();
            } else {
                debug('[DejaWindow] Waiting for Actor map:', identity);

                // Connect safely using connectObject
                actor.connectObject('notify::mapped', () => {
                    if (actor.mapped) {
                        debug('[DejaWindow] Actor became mapped (One-shot):', identity);

                        // Disconnect immediately to avoid repeated calls in Overview
                        // This is safe to do here because at this stage
                        // there are no other signals connected to this on that specific actor instance.
                        actor.disconnectObject(this);

                        // Clean up from our tracking array
                        const idx = handle.actors.indexOf(actor);
                        if (idx !== -1) handle.actors.splice(idx, 1);

                        triggerRestore();
                    }
                }, this);

                // Track this actor strictily
                handle.actors.push(actor);
            }
        };

        const actor = window.get_compositor_private();
        if (actor) {
            waitForActorMap(actor);
        } else {
            debug('[DejaWindow] Waiting for Compositor Private (Actor):', identity);
            // notify::compositor-private is a signal on the WINDOW
            window.connectObject('notify::compositor-private', () => {
                const newActor = window.get_compositor_private();
                if (newActor) {
                    debug('[DejaWindow] Compositor Private (Actor) available:', identity);
                    waitForActorMap(newActor);
                }
            }, this);
        }

        // --- SAVE LOGIC ---

        // Helper to handle window changes. Logs the window's frame rect and checks if we should save the window's state.
        const handleWindowChange = (window) => {
            // Bypassed: no saving while the logical switch is off.
            if (!this._functionalityEnabled) return;

            // If we haven't finished the initial restore, don't save anything!
            // Avoid overwriting saved state with partial coordinates during opening.
            if (!handle.isRestoreApplied) return;

            const rect = window.get_frame_rect();
            if (handle.timeoutId) {
                GLib.source_remove(handle.timeoutId);
                handle.timeoutId = 0;
            }

            // Dynamically get current config to respect live changes
            const effective = this._getEffectiveConfig(window);
            if (!effective || effective.config.locked === true) return;

            // Schedule a timeout to save the window's state
            handle.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                debug('[DejaWindow] Window changed (debounced):', identity);
                const isMaximized = window.maximized_horizontally || window.maximized_vertically;

                // Get additional states
                const workspace = window.get_workspace();
                const workspaceIndex = workspace ? workspace.index() : -1;
                const monitorIndex = window.get_monitor();

                this._performSave(effective.identity, monitorIndex, rect.x, rect.y, rect.width, rect.height,
                    effective.config, isMaximized, workspaceIndex, window.minimized, window.above, window.on_all_workspaces);

                handle.timeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        };

        // Helper to handle window unmanaging. Saves the window's state.
        const handleWindowUnmanaging = () => {
            debug('[DejaWindow] Window unmanaged:', identity);
            // Last save before closing (skipped while bypassed)
            if (this._functionalityEnabled && handle.isRestoreApplied) {
                const rect = window.get_frame_rect();
                const isMaximized = window.maximized_horizontally || window.maximized_vertically;

                // Get additional states
                const workspace = window.get_workspace();
                const workspaceIndex = workspace ? workspace.index() : -1;
                const monitorIndex = window.get_monitor();

                const effective = this._getEffectiveConfig(window);

                if (effective && effective.config.locked !== true) {
                    this._performSave(effective.identity, monitorIndex, rect.x, rect.y, rect.width, rect.height,
                        effective.config, isMaximized, workspaceIndex, window.minimized, window.above, window.on_all_workspaces);
                }
            }
            this._cleanupWindow(window);
        };

        // Connect signals using connectObject bound to 'this' extension instance
        window.connectObject('unmanaging', () => handleWindowUnmanaging(), this);
        window.connectObject('size-changed', () => handleWindowChange(window), this);
        window.connectObject('position-changed', () => handleWindowChange(window), this);
        window.connectObject('workspace-changed', () => handleWindowChange(window), this);
        window.connectObject('notify::minimized', () => handleWindowChange(window), this);
        window.connectObject('notify::above', () => handleWindowChange(window), this);
        window.connectObject('notify::on-all-workspaces', () => handleWindowChange(window), this);
    }

    // Applies the saved size and/or position, or falls back to centering if position is invalid/not requested.
    _applySavedState(window, identity, config) {
        const handle = this._handles.get(window);
        if (!handle || handle.isRestoreApplied) return;

        // Use idle_add LOW PRIORITY to ensure we run after any pending internal Mutter layout logic.
        // This is not a delay (time-based), but a priority-based scheduling.
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            if (handle.isRestoreApplied) return GLib.SOURCE_REMOVE;

            // Check if the window still exists
            if (!window.get_workspace()) return GLib.SOURCE_REMOVE;

            // Final Safety Check: Avoid Override Redirect windows
            if (window.is_override_redirect()) return GLib.SOURCE_REMOVE;

            // Double check actor mapping just to be absolutely sure
            const actor = window.get_compositor_private();
            if (!actor || !actor.mapped) {
                debug(`[DejaWindow] Window ${identity} actor not ready in idle, skipping...`);
                return GLib.SOURCE_REMOVE;
            }

            handle.isRestoreApplied = true;

            const needsRestore = config.restore_size || config.restore_pos || config.restore_maximized ||
                config.restore_workspace || config.restore_minimized || config.restore_above || config.restore_sticky;

            if (!needsRestore) {
                this._centerWindow(window);
                return GLib.SOURCE_REMOVE;
            }

            // ... (Rest of logic remains mostly same, just retrieving settings) ...
            let savedStates = {};
            try {
                savedStates = JSON.parse(this._settings.get_string('window-app-states')) || {};
            } catch (e) {
                console.error('[DejaWindow] Error reading window-app-states:', e);
            }

            // Get saved state for this window
            const state = savedStates[identity] || {};
            debug('[DejaWindow] Restoring state for:', identity, state);
            // Safety checks for X11
            if (!state) return GLib.SOURCE_REMOVE;

            const rect = window.get_frame_rect();

            // Retrieve target dimensions
            let targetW = rect.width;
            let targetH = rect.height;

            // Restore size if requested and available
            if (config.restore_size && state.width && state.height && state.width > 50 && state.height > 50) {
                targetW = state.width;
                targetH = state.height;
            }

            // Before we can determine the work area, we need to make sure the window is located on the correct monitor.
            // So, if we are restoring position, then check and move to the saved monitor.
            const targetMonitor = state.monitor ?? 0;
            // The saved monitor index may no longer exist (monitor unplugged, layout changed since last save).
            // Passing an out-of-range index to move_to_monitor() hits a fatal assertion in Mutter and crashes
            // the whole gnome-shell process, so it must be validated against the currently connected monitors.
            if (config.restore_pos && targetMonitor !== window.get_monitor() &&
                targetMonitor >= 0 && targetMonitor < global.display.get_n_monitors()) {
              // Restore (move) the window to the saved monitor
              window.move_to_monitor(targetMonitor);
            }

            // Retrieve target position
            let targetX = rect.x;
            let targetY = rect.y;
            const monitorIndex = window.get_monitor();
            const workspace = window.get_workspace();
            if (!workspace) return GLib.SOURCE_REMOVE;

            const workArea = workspace.get_work_area_for_monitor(monitorIndex);
            if (!workArea) return GLib.SOURCE_REMOVE;

            // Default to centered position as fallback
            targetX = workArea.x + (workArea.width - targetW) / 2;
            targetY = workArea.y + (workArea.height - targetH) / 2;

            // Restore position if requested and valid
            if (config.restore_pos && state.x !== undefined && state.y !== undefined && this._isPointInWorkArea(state.x, state.y, workArea)) {
                targetX = state.x;
                targetY = state.y;
            }

            if (config.avoid_overlap !== false) {
                // Avoid overlapping with existing windows of the same class
                [targetX, targetY] = this._findFreePosition(workspace, window, identity, targetX, targetY);

                // Final check to ensure we didn't drift out of the work area completely
                // If we did, we might want to clamp or just accept it.
                // For now, let's just clamp the top-left to be somewhat visible.
                if (targetX > workArea.x + workArea.width - 50) targetX = workArea.x + workArea.width - 50;
                if (targetY > workArea.y + workArea.height - 50) targetY = workArea.y + workArea.height - 50;
            }

            debug(`[DejaWindow] Applying State for ${identity}: ${targetW}x${targetH} @ ${targetX},${targetY}`);

            const isMaximized = window.maximized_horizontally || window.maximized_vertically;

            // If the window is already maximized and we are NOT configured to restore maximized state,
            // we should not interfere (do not unmaximize, do not apply geometry).
            // If we ARE configured to restore maximized state, we proceed to unmaximize and apply geometry
            // so that the "underlying" normal state is correct.
            if (!isMaximized || config.restore_maximized) {
                if (isMaximized) {
                    this._unmaximizeWindow(window);
                }
                // Apply geometry
                window.move_resize_frame(true, targetX, targetY, targetW, targetH);
            }

            // Restore Workspace
            if (config.restore_workspace && state.workspace !== undefined && state.workspace !== -1) {
                const ws = global.workspace_manager.get_workspace_by_index(state.workspace);
                if (ws) {
                    window.change_workspace(ws);

                    // Switch to desktop if configured
                    if (config.switch_to_workspace && ws !== global.workspace_manager.get_active_workspace()) {
                        const h = this._handles.get(window);
                        if (h) {
                            // Clear any pending timeout
                            if (h.wsTimeoutId) {
                                GLib.source_remove(h.wsTimeoutId);
                                h.wsTimeoutId = 0;
                            }

                            // Slight delay to ensure the window is visually positioned before switching
                            h.wsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                                ws.activate(global.get_current_time());
                                h.wsTimeoutId = 0;
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    }
                }
            }

            // Restore Always on Visible Workspace (Sticky)
            if (config.restore_sticky && state.sticky !== undefined) {
                state.sticky ? window.stick() : window.unstick();
            }

            // Restore Always on Top (Above)
            if (config.restore_above && state.above !== undefined) {
                state.above ? window.make_above() : window.unmake_above();
            }

            // Restore Minimized
            if (config.restore_minimized && state.minimized !== undefined) {
                state.minimized ? window.minimize() : window.unminimize();
            }

            // Apply Maximized State
            if (config.restore_maximized && state.maximized) {
                this._maximizeWindow(window);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    // Saves the current window geometry to GSettings for persistence across sessions.
    _performSave(identity, monitorIndex, x, y, w, h, config, isMaximized, workspaceIndex, minimized, above, sticky) {
        if (!this._settings) return;

        debug(`[DejaWindow] Saving State for ${identity}: ${w}x${h} @ ${x},${y}`);

        let savedStates = {};
        try {
            const json = this._settings.get_string('window-app-states');
            savedStates = JSON.parse(json) || {};
        } catch (e) {
            savedStates = {};
        }

        // Initialize state for this window if it doesn't exist
        if (!savedStates[identity]) {
            savedStates[identity] = {};
        }

        let changed = false;

        // Save Workspace
        if (config.restore_workspace && workspaceIndex !== -1 && savedStates[identity].workspace !== workspaceIndex) {
            savedStates[identity].workspace = workspaceIndex;
            changed = true;
        }
        // Save Minimized
        if (config.restore_minimized && savedStates[identity].minimized !== minimized) {
            savedStates[identity].minimized = minimized;
            changed = true;
        }
        // Save Above
        if (config.restore_above && savedStates[identity].above !== above) {
            savedStates[identity].above = above;
            changed = true;
        }
        // Save Sticky
        if (config.restore_sticky && savedStates[identity].sticky !== sticky) {
            savedStates[identity].sticky = sticky;
            changed = true;
        }

        // If we are restoring position and the monitor is different, then save the new monitor
        if (config.restore_pos
              && (monitorIndex !== 0 || savedStates[identity].monitor !== undefined)
              && savedStates[identity].monitor !== monitorIndex) {
            savedStates[identity].monitor = monitorIndex;
            changed = true;
        }

        // If maximized, we only save the maximized flag, NOT the current coordinates (which would be full screen).
        // Otherwise, we would overwrite the "normal" dimensions with the full-screen ones.
        if (isMaximized) {
            if (config.restore_maximized && savedStates[identity].maximized !== true) {
                savedStates[identity].maximized = true;
                changed = true;
            }
            // We don't save w/h/x/y when maximized to preserve the "unmaximized" state.
        } else {
            // If not maximized, we save dimensions and position and set maximized to false
            if (config.restore_maximized && savedStates[identity].maximized !== false) {
                savedStates[identity].maximized = false;
                changed = true;
            }
            if (config.restore_size && w > 50 && h > 50) {
                savedStates[identity].width = w;
                savedStates[identity].height = h;
                changed = true;
            }
            if (config.restore_pos && x > -10000 && y > -10000) {
                savedStates[identity].x = x;
                savedStates[identity].y = y;
                changed = true;
            }
        }

        // Save changes if any
        if (changed) {
            this._settings.set_string('window-app-states', JSON.stringify(savedStates));
        }
    }

    // Centers the window on the current monitor's work area.
    _centerWindow(window) {
        if (!window.get_workspace()) return false;
        const monitorIndex = window.get_monitor();
        const workspace = window.get_workspace();
        const workArea = workspace.get_work_area_for_monitor(monitorIndex);
        if (!workArea) return false;

        const frameRect = window.get_frame_rect();
        const targetX = workArea.x + (workArea.width - frameRect.width) / 2;
        const targetY = workArea.y + (workArea.height - frameRect.height) / 2;

        window.move_frame(false, targetX, targetY);
    }

    // Checks if a point (top-left corner of window) is roughly within the visible work area,
    // with some tolerance (50px) to ensure the window title bar is accessible.
    _isPointInWorkArea(x, y, area) {
        return x >= area.x - 50 &&
            x <= (area.x + area.width - 50) &&
            y >= area.y - 50 &&
            y <= (area.y + area.height - 50);
    }

    // Helper to find a free position for the window to avoid overlap
    _findFreePosition(workspace, window, identity, targetX, targetY) {
        // Iterative collision detection
        // We only care about collision if we have a valid target position (either saved or centered)
        // and we want to avoid perfect overlap with existing windows of the same class.

        // Get all windows on the same workspace
        const windows = workspace.list_windows();

        // Filter for windows of the same class that are visible (not hidden/minimized)
        const others = windows.filter(w => {
            return w !== window &&
                w.get_wm_class() === identity &&
                !w.minimized &&
                w.showing_on_its_workspace();
        });

        // Loop to find a free position
        // We limit iterations to avoid infinite loops (e.g. if screen is full)
        const MAX_ITERATIONS = 50;
        const OFFSET_STEP = 50; // Approximate title bar height
        const TOLERANCE = 10;   // Pixel tolerance for "overlap"

        for (let i = 0; i < MAX_ITERATIONS; i++) {
            let collision = false;
            for (const other of others) {
                const otherRect = other.get_frame_rect();

                // Check if 'other' window is at the current candidate position (roughly)
                // We mainly care about the top-left corner matching, which causes the exact overlap occlusion.
                const dist = Math.abs(otherRect.x - targetX) + Math.abs(otherRect.y - targetY);
                if (dist < TOLERANCE) {
                    collision = true;
                    break;
                }
            }
            if (collision) {
                // Apply offset and try again
                targetX += OFFSET_STEP;
                targetY += OFFSET_STEP;
            } else {
                // No collision at this position, we are good
                break;
            }
        }
        return [targetX, targetY];
    }
}
