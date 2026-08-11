import * as WindowMenu from 'resource:///org/gnome/shell/ui/windowMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Default restore_* flags applied to a rule created from the window menu: the
// user picked "Managed by ..." meaning "manage everything about this window",
// so start fully enabled rather than an inert rule the user has to open
// Settings just to activate.
const NEW_RULE_DEFAULTS = {
    enabled: true,
    is_regex: false,
    locked: false,
    restore_size: true,
    restore_pos: true,
    restore_maximized: true,
    restore_workspace: true,
    switch_to_workspace: true,
    restore_minimized: true,
    restore_above: true,
    restore_sticky: true,
};

/**
 * Adds a "Deja Window" submenu to GNOME Shell's window menu (the menu shown
 * from the title bar's right-click / Super+Space), mirroring how extensions
 * like Tiling Shell inject items: wrap WindowMenu.prototype._buildMenu so the
 * original menu is built first, then append our own items.
 */
export class DejaWindowMenu {
    constructor(extension) {
        this._extension = extension;
        this._originalBuildMenu = null;
    }

    enable() {
        if (this._originalBuildMenu) return;

        const self = this;
        this._originalBuildMenu = WindowMenu.WindowMenu.prototype._buildMenu;
        WindowMenu.WindowMenu.prototype._buildMenu = function (window) {
            self._originalBuildMenu.call(this, window);
            self._appendSubmenu(this, window);
        };
    }

    disable() {
        if (!this._originalBuildMenu) return;

        WindowMenu.WindowMenu.prototype._buildMenu = this._originalBuildMenu;
        this._originalBuildMenu = null;
    }

    // Same matching rule as DejaWindowExtension._getConfigForWindow: a config
    // matches by wm_class or title (literal or regex) depending on match_mode,
    // and a disabled rule never matches (same effect as if it were deleted).
    _configMatches(config, wmClass, title) {
        if (config.enabled === false) return false;

        const mode = config.match_mode || 'wm_class';
        const value = mode === 'title' ? title : wmClass;
        if (!value) return false;

        if (config.is_regex) {
            try {
                return new RegExp(config.wm_class).test(value);
            } catch (e) {
                return false;
            }
        }
        return config.wm_class === value;
    }

    _readState(wmClass, title) {
        const settings = this._extension._settings;

        let configs = [];
        try {
            configs = JSON.parse(settings.get_string('window-app-configs')) || [];
        } catch (e) {
            configs = [];
        }

        let globalDefaults = {};
        try {
            globalDefaults = JSON.parse(settings.get_string('window-global-defaults')) || {};
        } catch (e) {
            globalDefaults = {};
        }

        // The rule (enabled or not) that "activate" acts on: literal identity
        // match on (pattern, mode), ignoring enabled/is_regex. Reusing this
        // slot on re-activation is what lets a disabled rule keep its
        // customization instead of a fresh blank one being created.
        const slotClass = wmClass
            ? configs.find(c => (c.match_mode || 'wm_class') === 'wm_class' && c.wm_class === wmClass)
            : null;
        const slotTitle = title
            ? configs.find(c => c.match_mode === 'title' && c.wm_class === title)
            : null;

        // The rule actually governing this window right now, if any: an
        // enabled config matching by literal value or regex (same priority as
        // DejaWindowExtension._getEffectiveConfig's explicit-config lookup).
        const activeConfig = configs.find(c => this._configMatches(c, wmClass, title));

        const excludedList = globalDefaults.excluded_wm_classes || [];
        const excludedIdx = wmClass ? excludedList.indexOf(wmClass) : -1;

        const state = activeConfig
            ? (activeConfig.match_mode === 'title' ? 'name' : 'class')
            : (excludedIdx !== -1 ? 'excluded' : 'unmanaged');

        return { configs, globalDefaults, activeConfig, slotClass, slotTitle, excludedList, excludedIdx, state };
    }

    _appendSubmenu(menu, window) {
        const wmClass = window.get_wm_class();
        const title = window.get_title();
        if (!wmClass && !title) return;

        const { state, globalDefaults } = this._readState(wmClass, title);
        const managed = state === 'class' || state === 'name';

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const submenu = new PopupMenu.PopupSubMenuMenuItem('Deja Window');
        menu.addMenuItem(submenu);

        const addItem = (label, key, enabled) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.setOrnament(state === key ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            if (!enabled) item.setSensitive(false);
            item.connect('activate', () => this._applyState(window, wmClass, title, key));
            submenu.menu.addMenuItem(item);
        };

        addItem('Managed by Window Class', 'class', !!wmClass);
        addItem('Managed by Window Title', 'name', !!title);

        // Only meaningful once one of the two "Managed by" rules is active.
        const customizeItem = new PopupMenu.PopupMenuItem('Customize');
        // Reserve the same ornament gutter as the radio items above/below, so
        // its label lines up with theirs instead of sitting flush left.
        customizeItem.setOrnament(PopupMenu.Ornament.NONE);
        if (!managed) customizeItem.setSensitive(false);
        customizeItem.connect('activate', () => this._openCustomize(wmClass, title));
        submenu.menu.addMenuItem(customizeItem);

        submenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // With Global Defaults enabled, an "Unmanaged" window isn't actually
        // untouched: it still gets managed via Global Defaults, so say so.
        const unmanagedLabel = globalDefaults.enabled ? ' Managed by Global Defaults' : 'Unmanaged';
        addItem(unmanagedLabel, 'unmanaged', true);
        addItem('Excluded', 'excluded', !!wmClass);
    }

    // Opens Preferences with the window's current rule pre-expanded. Since
    // prefs.js runs in a separate process, the target rule is handed over via
    // a one-shot GSettings key rather than any direct call.
    _openCustomize(wmClass, title) {
        const settings = this._extension._settings;
        if (!settings) return;

        const { activeConfig } = this._readState(wmClass, title);
        if (!activeConfig) return;

        settings.set_string('prefs-highlight-target', JSON.stringify({
            wm_class: activeConfig.wm_class,
            match_mode: activeConfig.match_mode || 'wm_class',
        }));
        this._extension.openPreferences();
    }

    _applyState(window, wmClass, title, targetState) {
        const settings = this._extension._settings;
        if (!settings) return;

        const { configs, globalDefaults, activeConfig, slotClass, slotTitle, excludedList, excludedIdx, state } =
            this._readState(wmClass, title);

        // Radio-style items: clicking the already-active one is a no-op.
        if (state === targetState) return;

        let configsChanged = false;
        let defaultsChanged = false;

        // Disables whatever rule currently governs this window (if any),
        // unless it's the rule we're about to keep/enable. Never deletes: the
        // rule (and its customization) stays around, just switched off, so
        // switching back later restores it instead of starting from scratch.
        const retireActiveConfig = (keep) => {
            if (activeConfig && activeConfig !== keep && activeConfig.enabled !== false) {
                activeConfig.enabled = false;
                configsChanged = true;
            }
        };

        if (targetState === 'class' || targetState === 'name') {
            const pattern = targetState === 'class' ? wmClass : title;
            if (!pattern) return;

            let slot = targetState === 'class' ? slotClass : slotTitle;
            if (slot) {
                // Re-enable the existing (possibly hand-customized) rule for
                // this exact wm_class/title instead of creating a duplicate.
                if (slot.enabled === false) {
                    slot.enabled = true;
                    configsChanged = true;
                }
            } else {
                slot = {
                    wm_class: pattern,
                    match_mode: targetState === 'class' ? 'wm_class' : 'title',
                    ...NEW_RULE_DEFAULTS,
                };
                configs.push(slot);
                configsChanged = true;
            }

            retireActiveConfig(slot);

            if (excludedIdx !== -1) {
                excludedList.splice(excludedIdx, 1);
                globalDefaults.excluded_wm_classes = excludedList;
                defaultsChanged = true;
            }
        } else if (targetState === 'unmanaged') {
            retireActiveConfig(null);

            if (excludedIdx !== -1) {
                excludedList.splice(excludedIdx, 1);
                globalDefaults.excluded_wm_classes = excludedList;
                defaultsChanged = true;
            }
        } else if (targetState === 'excluded') {
            if (!wmClass) return;

            retireActiveConfig(null);

            excludedList.push(wmClass);
            globalDefaults.excluded_wm_classes = excludedList;
            defaultsChanged = true;
        }

        if (configsChanged) {
            settings.set_string('window-app-configs', JSON.stringify(configs));
        }
        if (defaultsChanged) {
            settings.set_string('window-global-defaults', JSON.stringify(globalDefaults));
        }

        // GSettings 'changed' signals may not be dispatched synchronously, so
        // refresh the extension's caches ourselves and (un)adopt this exact
        // window right away instead of waiting for the next signal/event.
        this._extension._updateConfigs();
        this._extension._updateGlobalDefaults();
        if (!this._extension._handles.has(window)) {
            this._extension._checkAndSetup(window);
        }
    }
}
