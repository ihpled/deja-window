import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


/**
 * DejaWindowExtension Class
 * 
 * The main class for the "Deja Window" extension.
 * This extension allows users to manage the size, position, and maximized state
 * of application windows. It supports:
 * - Saving and restoring window dimensions and position per WM_CLASS.
 * - Restoring maximized state.
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
    }

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
                console.log(`[DejaWindow] No longer managing: ${wmClass}`);
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

        console.log('[DejaWindow] Setup listeners for:', wmClass);

        const handle = {
            signalIds: [],
            timeoutId: 0,
            isRestoreApplied: false
        };
        this._handles.set(window, handle);

        // Function to schedule a delayed save operation
        const scheduleSave = (rect) => {
            if (handle.timeoutId) {
                GLib.source_remove(handle.timeoutId);
                handle.timeoutId = 0;
            }

            // Dynamically get current config to respect live changes
            const currentConfig = this._getConfigForWindow(wmClass);
            if (!currentConfig) {
                console.log('[DejaWindow] No config found for:', wmClass);
                return; // Should not happen if cleanup works, but safety first
            }

            handle.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                const isMaximized = window.maximized_horizontally || window.maximized_vertically;
                this._performSave(wmClass, rect.x, rect.y, rect.width, rect.height,
                    currentConfig.restore_size, currentConfig.restore_pos,
                    currentConfig.restore_maximized, isMaximized);
                handle.timeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        };

        // Helper to handle window changes. Re-applies restore settings if needed.
        const handleWindowChange = () => {
            // Re-fetch config to ensure we use latest settings (e.g. user toggled restore off)
            const currentConfig = this._getConfigForWindow(wmClass);
            if (!currentConfig) {
                // If config is gone, we should have been cleaned up, but abort here just in case
                return;
            }

            const restoreSize = currentConfig.restore_size;
            const restorePos = currentConfig.restore_pos;
            const restoreMaximized = currentConfig.restore_maximized;
            const needsRestore = restoreSize || restorePos || restoreMaximized;

            if (!handle.isRestoreApplied) {
                handle.isRestoreApplied = true;
                if (needsRestore) {
                    this._applySavedState(window, wmClass, restoreSize, restorePos, restoreMaximized);
                } else {
                    this._centerWindow(window);
                }
            }

            const rect = window.get_frame_rect();
            scheduleSave(rect);
        };

        // Connect signals for window changes
        const idSize = window.connect('size-changed', () => handleWindowChange());
        const idPos = window.connect('position-changed', () => handleWindowChange());

        // Handle window destruction to auto-cleanup
        const idUnmap = window.connect('unmanaging', () => {
            this._cleanupWindow(window);
        });

        // Store signal IDs for cleanup
        handle.signalIds.push(idSize, idPos, idUnmap);
    }

    // Applies the saved size and/or position, or falls back to centering if position is invalid/not requested.
    _applySavedState(window, wmClass, restoreSize, restorePos, restoreMaximized) {
        const rect = window.get_frame_rect();

        let savedStates = {};
        try {
            savedStates = JSON.parse(this._settings.get_string('window-app-states')) || {};
        } catch (e) {
            console.error('[DejaWindow] Error reading window-app-states:', e);
        }

        // Get saved state for this window
        const state = savedStates[wmClass] || {};

        // Retrieve target dimensions
        let targetW = rect.width;
        let targetH = rect.height;

        // Restore size if requested and available
        if (restoreSize && state.width && state.height) {
            if (state.width > 100 && state.height > 100) {
                targetW = state.width;
                targetH = state.height;
            }
        }

        // Retrieve target position
        let targetX = rect.x;
        let targetY = rect.y;

        const monitorIndex = window.get_monitor();

        const workspace = window.get_workspace();
        if (!workspace) return;

        const workArea = workspace.get_work_area_for_monitor(monitorIndex);
        if (!workArea) return;

        let useCenterFallback = true;

        // Restore position if requested and available
        if (restorePos && state.x !== undefined && state.y !== undefined) {
            if (this._isPointInWorkArea(state.x, state.y, workArea)) {
                targetX = state.x;
                targetY = state.y;
                useCenterFallback = false;
            }
        }

        // Use center fallback if no valid position was found
        if (useCenterFallback) {
            targetX = workArea.x + (workArea.width - targetW) / 2;
            targetY = workArea.y + (workArea.height - targetH) / 2;
        }

        console.log(`[DejaWindow] Applying State for ${wmClass}: ${targetW}x${targetH} @ ${targetX},${targetY}`);

        // Apply geometry
        window.move_resize_frame(false, targetX, targetY, targetW, targetH);

        // Apply Maximized State
        if (restoreMaximized && state.maximized) {
            console.log(`[DejaWindow] Maximizing ${wmClass}`);
            window.maximize(Meta.MaximizeFlags.BOTH);
        }
    }

    // Saves the current window geometry to GSettings for persistence across sessions.
    _performSave(wmClass, x, y, w, h, restoreSize, restorePos, restoreMaximized, isMaximized) {
        if (!this._settings) return;

        // console.log(`[DejaWindow] Saving State for ${wmClass}: ${w}x${h} @ ${x},${y} (Max: ${isMaximized})`);

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

        // Save size if requested and not maximized
        if (restoreSize && !isMaximized) {
            if (w > 100 && h > 100) {
                savedStates[wmClass].width = w;
                savedStates[wmClass].height = h;
                changed = true;
            }
        }

        // Save position if requested and not maximized
        if (restorePos && !isMaximized) {
            if (x > -10000 && y > -10000) {
                savedStates[wmClass].x = x;
                savedStates[wmClass].y = y;
                changed = true;
            }
        }

        // Save maximized state if requested
        if (restoreMaximized) {
            if (savedStates[wmClass].maximized !== isMaximized) {
                savedStates[wmClass].maximized = isMaximized;
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

        const frameRect = window.get_frame_rect();
        const monitorIndex = window.get_monitor();
        const workspace = window.get_workspace();
        const workArea = workspace.get_work_area_for_monitor(monitorIndex);

        if (!workArea) return false;

        const targetX = workArea.x + (workArea.width - frameRect.width) / 2;
        const targetY = workArea.y + (workArea.height - frameRect.height) / 2;

        console.log(`[DejaWindow] Centering Window: ${frameRect.width}x${frameRect.height} @ ${targetX},${targetY}`);

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
}