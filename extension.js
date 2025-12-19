import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const DEBUG = false;

function debug(...args) {
    if (DEBUG) console.log(...args);
}


/**
 * DejaWindowExtension Class
 * 
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
 */
export default class DejaWindowExtension extends Extension {
    enable() {
        // Initialize settings from schema
        this._settings = this.getSettings();

        // Map<Window, { signalIds: number[], timeoutId: number }>
        this._handles = new Map();

        // Cache for configurations to avoid parsing JSON on every window creation
        this._configs = [];
        this._updateConfigs();

        // Listen for config changes
        this._configSignalId = this._settings.connect('changed::window-app-configs', () => {
            this._updateConfigs();
        });

        // Subscribe to the global 'window-created' event to detect new windows
        this._handlerId = global.display.connect('window-created', (display, window) => {
            this._onWindowCreated(window);
        });

        // Handle already existing windows (Crucial for X11 and reload)
        // We use an idle callback to ensure the loop starts after full initialization
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            // Meta.TabList.NORMAL includes standard managed windows
            const windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
            for (const window of windows) {
                this._onWindowCreated(window);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        // Clean up all managed windows
        for (const window of this._handles.keys()) {
            this._cleanupWindow(window);
        }
        this._handles.clear();

        // Clean up the event listener when the extension is disabled
        if (this._handlerId) {
            global.display.disconnect(this._handlerId);
            this._handlerId = null;
        }

        // Clean up the config listener when the extension is disabled
        if (this._configSignalId) {
            this._settings.disconnect(this._configSignalId);
            this._configSignalId = null;
        }

        this._settings = null;
        this._configs = [];
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

        // Cleanup windows that are no longer in consideration
        for (const [window, handle] of this._handles) {
            const wmClass = window.get_wm_class();
            if (!this._getConfigForWindow(wmClass)) {
                debug(`[DejaWindow] No longer managing: ${wmClass}`);
                this._cleanupWindow(window);
            }
        }
    }

    // Helper to find a matching config for a given WM_CLASS
    _getConfigForWindow(wmClass) {
        if (!wmClass) return null;
        return this._configs.find(c => {
            if (c.is_regex) {
                try {
                    return new RegExp(c.wm_class).test(wmClass);
                } catch (e) {
                    return false;
                }
            } else {
                return c.wm_class === wmClass;
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

        // Disconnect signals
        handle.signalIds.forEach(id => {
            try {
                window.disconnect(id);
            } catch (e) {
                // Ignore errors if window is already destroyed
            }
        });

        this._handles.delete(window);
    }

    // Helper to handle window creation. Records WM_CLASS and checks if we should manage the window.
    _onWindowCreated(window) {
        // If we're already handling this window, exit early.
        if (this._handles.has(window)) return;

        // Sometimes the WM class is not immediately available, so we check or wait for the property to change.
        if (window.get_wm_class()) {
            this._recordWmClass(window.get_wm_class());
            this._checkAndSetup(window);
        } else {
            const notifyId = window.connect('notify::wm-class', () => {
                window.disconnect(notifyId);
                const wmClass = window.get_wm_class();
                if (wmClass) {
                    this._recordWmClass(wmClass);
                }
                this._checkAndSetup(window);
            });
        }
    }

    // Helper to check if we should manage a window. If so, sets up listeners.
    _checkAndSetup(window) {
        const wmClass = window.get_wm_class();
        if (!wmClass) return;

        // Check if we should manage this window
        const config = this._getConfigForWindow(wmClass);
        if (config) {
            this._setupListeners(window, wmClass);
        }
    }

    // Sets up specific listeners for configured windows to handle resizing, positioning, and saving state.
    _setupListeners(window, wmClass) {
        if (this._handles.has(window)) {
            return; // Already registered
        }

        debug('[DejaWindow] Setup listeners for:', wmClass);

        const handle = {
            signalIds: [],
            timeoutId: 0,
            wsTimeoutId: 0,
            isRestoreApplied: false
        };
        this._handles.set(window, handle);

        // Helper to handle window shown. Logs the window's frame rect and checks if we should restore the window.
        const handleWindowShown = () => {
            debug('[DejaWindow] Window shown:', wmClass);
            // If we've already restored, avoid doing it again (loop prevention)
            if (handle.isRestoreApplied) return;

            const currentConfig = this._getConfigForWindow(wmClass);
            if (currentConfig) {
                this._applySavedState(window, wmClass, currentConfig);
            }
        };

        // Helper to handle window changes. Logs the window's frame rect and checks if we should save the window's state.
        const handleWindowChange = (window) => {
            // If we haven't finished the initial restore, don't save anything!
            // Avoid overwriting saved state with partial coordinates during opening.
            if (!handle.isRestoreApplied) {
                const currentConfig = this._getConfigForWindow(wmClass);
                if (currentConfig) {
                    this._applySavedState(window, wmClass, currentConfig);
                }
                return;
            }

            const rect = window.get_frame_rect();
            if (handle.timeoutId) {
                GLib.source_remove(handle.timeoutId);
                handle.timeoutId = 0;
            }

            // Dynamically get current config to respect live changes
            const currentConfig = this._getConfigForWindow(wmClass);
            if (!currentConfig) {
                debug('[DejaWindow] No config found for:', wmClass);
                return; // Should not happen if cleanup works, but safety first
            }

            // Schedule a timeout to save the window's state
            handle.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                debug('[DejaWindow] Window changed (debounced):', wmClass);
                const isMaximized = window.maximized_horizontally || window.maximized_vertically;

                // Get additional states
                const workspace = window.get_workspace();
                const workspaceIndex = workspace ? workspace.index() : -1;
                const minimized = window.minimized;
                const above = window.above;
                const sticky = window.on_all_workspaces;

                this._performSave(wmClass, rect.x, rect.y, rect.width, rect.height,
                    currentConfig, isMaximized, workspaceIndex, minimized, above, sticky);
                handle.timeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        };

        // Helper to handle window unmanaging. Saves the window's state.
        const handleWindowUnmanaging = () => {
            debug('[DejaWindow] Window unmanaged:', wmClass);
            // Last save before closing
            if (handle.isRestoreApplied) {
                const rect = window.get_frame_rect();
                const isMaximized = window.maximized_horizontally || window.maximized_vertically;

                // Get additional states
                const workspace = window.get_workspace();
                const workspaceIndex = workspace ? workspace.index() : -1;
                const minimized = window.minimized;
                const above = window.above;
                const sticky = window.on_all_workspaces;

                const currentConfig = this._getConfigForWindow(wmClass);
                if (!currentConfig) {
                    debug('[DejaWindow] No config found for:', wmClass);
                    return;
                }


                this._performSave(wmClass, rect.x, rect.y, rect.width, rect.height,
                    currentConfig, isMaximized, workspaceIndex, minimized, above, sticky);
            }
            this._cleanupWindow(window);
        };

        // Connect to window signals
        const idShown = window.connect('shown', () => handleWindowShown());
        const idUnmap = window.connect('unmanaging', () => handleWindowUnmanaging());
        const idSize = window.connect('size-changed', () => handleWindowChange(window));
        const idPos = window.connect('position-changed', () => handleWindowChange(window));
        const idWorkspace = window.connect('workspace-changed', () => handleWindowChange(window));
        const idMinimized = window.connect('notify::minimized', () => handleWindowChange(window));
        const idAbove = window.connect('notify::above', () => handleWindowChange(window));
        const idSticky = window.connect('notify::on-all-workspaces', () => handleWindowChange(window));


        // Store signal IDs for cleanup
        handle.signalIds.push(idShown, idUnmap, idSize, idPos, idWorkspace, idMinimized, idAbove, idSticky);

        if (!Meta.is_wayland_compositor()) { // Only execute on X11
            // CRITICAL FIX FOR X11:
            // If the window is already visible or mapped when we get here, the 'shown' signal
            // might never fire. We manually check.
            // window.get_compositor_private() is a good indicator if the actor has already been created.
            if (window.get_compositor_private() || window.appearing) {
                debug('[DejaWindow] Window already visible or mapped:', wmClass);
                handleWindowShown();
            }
        }
    }

    // Applies the saved size and/or position, or falls back to centering if position is invalid/not requested.
    _applySavedState(window, wmClass, config) {

        const handle = this._handles.get(window);
        if (!handle) return;

        if (handle.isRestoreApplied) return;

        // Use idle_add to ensure the window is fully ready/mapped before applying state
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (handle.isRestoreApplied) return GLib.SOURCE_REMOVE;

            // Check if the window still exists
            if (!window.get_workspace()) return GLib.SOURCE_REMOVE;

            handle.isRestoreApplied = true;

            const needsRestore = config.restore_size ||
                config.restore_pos ||
                config.restore_maximized ||
                config.restore_workspace ||
                config.restore_minimized ||
                config.restore_above ||
                config.restore_sticky;

            if (!needsRestore) {
                this._centerWindow(window);
                return GLib.SOURCE_REMOVE;
            }

            const rect = window.get_frame_rect();

            let savedStates = {};
            try {
                savedStates = JSON.parse(this._settings.get_string('window-app-states')) || {};
            } catch (e) {
                console.error('[DejaWindow] Error reading window-app-states:', e);
            }

            // Get saved state for this window
            const state = savedStates[wmClass] || {};

            // Safety checks for X11
            if (!state) return GLib.SOURCE_REMOVE;

            // Retrieve target dimensions
            let targetW = rect.width;
            let targetH = rect.height;

            // Restore size if requested and available
            if (config.restore_size && state.width && state.height && state.width > 50 && state.height > 50) {
                targetW = state.width;
                targetH = state.height;
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

            // Avoid overlapping with existing windows of the same class
            [targetX, targetY] = this._findFreePosition(workspace, window, wmClass, targetX, targetY);

            // Final check to ensure we didn't drift out of the work area completely
            // If we did, we might want to clamp or just accept it. 
            // For now, let's just clamp the top-left to be somewhat visible.
            if (targetX > workArea.x + workArea.width - 50) targetX = workArea.x + workArea.width - 50;
            if (targetY > workArea.y + workArea.height - 50) targetY = workArea.y + workArea.height - 50;


            debug(`[DejaWindow] Applying State for ${wmClass}: ${targetW}x${targetH} @ ${targetX},${targetY}`);

            const isMaximized = window.maximized_horizontally || window.maximized_vertically;

            // If the window is already maximized and we are NOT configured to restore maximized state,
            // we should not interfere (do not unmaximize, do not apply geometry).
            // If we ARE configured to restore maximized state, we proceed to unmaximize and apply geometry
            // so that the "underlying" normal state is correct.
            if (!isMaximized || config.restore_maximized) {
                if (isMaximized) {
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
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
                        const handle = this._handles.get(window);
                        if (handle) {
                            // Clear any pending timeout
                            if (handle.wsTimeoutId) {
                                GLib.source_remove(handle.wsTimeoutId);
                                handle.wsTimeoutId = 0;
                            }
                            // Slight delay to ensure the window is visually positioned before switching
                            handle.wsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                                ws.activate(global.get_current_time());
                                handle.wsTimeoutId = 0;
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    }
                }
            }

            // Restore Always on Visible Workspace (Sticky)
            if (config.restore_sticky && state.sticky !== undefined) {
                if (state.sticky) {
                    window.stick();
                } else {
                    window.unstick();
                }
            }

            // Restore Always on Top (Above)
            if (config.restore_above && state.above !== undefined) {
                if (state.above) {
                    window.make_above();
                } else {
                    window.unmake_above();
                }
            }

            // Restore Minimized
            if (config.restore_minimized && state.minimized !== undefined) {
                if (state.minimized) {
                    window.minimize();
                } else {
                    window.unminimize();
                }
            }

            // Apply Maximized State
            if (config.restore_maximized && state.maximized) {
                window.maximize(Meta.MaximizeFlags.BOTH);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    // Saves the current window geometry to GSettings for persistence across sessions.
    _performSave(wmClass, x, y, w, h, config, isMaximized, workspaceIndex, minimized, above, sticky) {
        if (!this._settings) return;

        debug(`[DejaWindow] Saving State for ${wmClass}: ${w}x${h} @ ${x},${y} (Max: ${isMaximized})`);

        let savedStates = {};
        try {
            const json = this._settings.get_string('window-app-states');
            savedStates = JSON.parse(json) || {};
        } catch (e) {
            // console.error('[DejaWindow] Error parsing window-app-states for save:', e);
            savedStates = {};
        }

        // Initialize state for this window if it doesn't exist
        if (!savedStates[wmClass]) {
            savedStates[wmClass] = {};
        }

        let changed = false;

        // Save Workspace
        if (config.restore_workspace && workspaceIndex !== -1 && savedStates[wmClass].workspace !== workspaceIndex) {
            savedStates[wmClass].workspace = workspaceIndex;
            changed = true;
        }

        // Save Minimized
        if (config.restore_minimized && savedStates[wmClass].minimized !== minimized) {
            savedStates[wmClass].minimized = minimized;
            changed = true;
        }

        // Save Above
        if (config.restore_above && savedStates[wmClass].above !== above) {
            savedStates[wmClass].above = above;
            changed = true;
        }

        // Save Sticky
        if (config.restore_sticky && savedStates[wmClass].sticky !== sticky) {
            savedStates[wmClass].sticky = sticky;
            changed = true;
        }

        // If maximized, we only save the maximized flag, NOT the current coordinates (which would be full screen).
        // Otherwise, we would overwrite the "normal" dimensions with the full-screen ones.
        if (isMaximized) {
            if (config.restore_maximized && savedStates[wmClass].maximized !== true) {
                savedStates[wmClass].maximized = true;
                changed = true;
            }
            // We don't save w/h/x/y when maximized to preserve the "unmaximized" state.
        } else {
            // If not maximized, we save dimensions and position and set maximized to false
            if (config.restore_maximized && savedStates[wmClass].maximized !== false) {
                savedStates[wmClass].maximized = false;
                changed = true;
            }

            if (config.restore_size && w > 50 && h > 50) {
                savedStates[wmClass].width = w;
                savedStates[wmClass].height = h;
                changed = true;
            }

            if (config.restore_pos && x > -10000 && y > -10000) {
                savedStates[wmClass].x = x;
                savedStates[wmClass].y = y;
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

        debug(`[DejaWindow] Centering Window: ${frameRect.width}x${frameRect.height} @ ${targetX},${targetY}`);

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
    _findFreePosition(workspace, window, wmClass, targetX, targetY) {
        // Iterative collision detection
        // We only care about collision if we have a valid target position (either saved or centered)
        // and we want to avoid perfect overlap with existing windows of the same class.

        // Get all windows on the same workspace
        const windows = workspace.list_windows();

        // Filter for windows of the same class that are visible (not hidden/minimized)
        const others = windows.filter(w => {
            return w !== window &&
                w.get_wm_class() === wmClass &&
                !w.minimized &&
                w.showing_on_its_workspace();
        });

        // Loop to find a free position
        // We limit iterations to avoid infinite loops (e.g. if screen is full)
        const MAX_ITERATIONS = 50;
        const OFFSET_STEP = 50; // Approximate title bar height
        const TOLERANCE = 10; // Pixel tolerance for "overlap"

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
