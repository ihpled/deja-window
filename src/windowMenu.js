import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WindowMenu from 'resource:///org/gnome/shell/ui/windowMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Default restore_* flags applied to a rule created from the window menu: the
// user flipped "Manage this window" meaning "manage everything about this
// window", so start fully enabled rather than an inert rule the user has to
// open Settings just to activate.
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

// The per-rule restore_* switches, in menu order. Labels are deliberately much
// shorter than their prefs counterparts ("On All Workspaces" vs "Restore Always
// on Visible Workspace"): the window menu is narrow and every label widens it.
// 'dependsOn' greys a switch out while the flag it refines is off.
const RESTORE_TOGGLES = [
    { key: 'restore_size', label: 'Size' },
    { key: 'restore_pos', label: 'Position' },
    { key: 'restore_maximized', label: 'Maximized' },
    { key: 'restore_workspace', label: 'Workspace' },
    { key: 'switch_to_workspace', label: 'Switch to Workspace', dependsOn: 'restore_workspace' },
    { key: 'restore_minimized', label: 'Minimized' },
    { key: 'restore_above', label: 'Always on Top' },
    { key: 'restore_sticky', label: 'On All Workspaces' },
];

// Identity patterns (especially titles) can be arbitrarily long; the header
// label would otherwise stretch the whole window menu.
const MAX_HEADER_PATTERN = 34;

// Breathing room left between the capped menu and the edge of the work area.
const HEIGHT_LIMIT_MARGIN = 24;

// Never cap the menu below this, however little room the title bar leaves: a
// tighter limit would clip GNOME's own items with no way to scroll to them.
const MIN_HEIGHT_LIMIT = 200;

function ellipsize(text) {
    if (!text) return '';
    return text.length > MAX_HEADER_PATTERN
        ? `${text.slice(0, MAX_HEADER_PATTERN - 1)}…`
        : text;
}

/**
 * Adds a "Deja Window" submenu to GNOME Shell's window menu (the menu shown
 * from the title bar's right-click / Super+Space), mirroring how extensions
 * like Tiling Shell inject items: wrap WindowMenu.prototype._buildMenu so the
 * original menu is built first, then append our own items.
 *
 * The submenu is a full rule editor, not just a mode picker: the whole rule
 * (match mode, every restore_* flag, the lock) is editable in place so the
 * common case never needs Preferences. Only regex rules and the rest of the
 * prefs surface still require opening Settings.
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

        // The window menu only manages exact (non-regex) exclusion rules by
        // wm_class or title; regex exclusion rules are editable from
        // Preferences only.
        const excludedList = globalDefaults.excluded_apps || [];
        const excludedClassIdx = wmClass
            ? excludedList.findIndex(r => r.wm_class === wmClass && (r.match_mode || 'wm_class') === 'wm_class' && !r.is_regex)
            : -1;
        const excludedTitleIdx = title
            ? excludedList.findIndex(r => r.wm_class === title && r.match_mode === 'title' && !r.is_regex)
            : -1;

        let state;
        if (activeConfig) {
            state = activeConfig.match_mode === 'title' ? 'name' : 'class';
        } else if (excludedClassIdx !== -1) {
            state = 'excluded-class';
        } else if (excludedTitleIdx !== -1) {
            state = 'excluded-title';
        } else {
            state = 'unmanaged';
        }

        return { configs, globalDefaults, activeConfig, slotClass, slotTitle, excludedList, excludedClassIdx, excludedTitleIdx, state };
    }

    // One line describing what governs this window right now, so the switches
    // below have a subject: which pattern is matched, and by what.
    _headerText(status) {
        const { state, activeConfig, pattern, globalDefaults } = status;

        if (state === 'class' || state === 'name') {
            if (activeConfig.is_regex) return `${ellipsize(activeConfig.wm_class)} — regex rule`;
            return `${ellipsize(pattern)} — matched by ${state === 'name' ? 'title' : 'class'}`;
        }
        if (state === 'excluded-class' || state === 'excluded-title') {
            return `${ellipsize(pattern)} — excluded`;
        }
        // Nothing explicit: Global Defaults may still be managing this window,
        // so don't claim it's untouched when it isn't.
        return globalDefaults.enabled ? 'Managed by Global Defaults' : 'Not managed';
    }

    // Flattens _readState into what the switches actually need.
    _status(wmClass, title) {
        const st = this._readState(wmClass, title);
        const managed = st.state === 'class' || st.state === 'name';
        const excluded = st.state === 'excluded-class' || st.state === 'excluded-title';
        const modeIsTitle = st.state === 'name' || st.state === 'excluded-title';

        return {
            ...st,
            managed,
            excluded,
            modeIsTitle,
            // A regex rule can match many windows; the menu must not silently
            // rewrite or retire it on this window's behalf.
            isRegex: managed && !!st.activeConfig.is_regex,
            config: st.activeConfig || {},
            pattern: modeIsTitle ? title : wmClass,
        };
    }

    _appendSubmenu(menu, window) {
        const wmClass = window.get_wm_class();
        const title = window.get_title();
        if (!wmClass && !title) return;

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const submenu = new PopupMenu.PopupSubMenuMenuItem('Deja Window');
        menu.addMenuItem(submenu);

        // 'restoreOpen' is the only piece of menu state that isn't backed by
        // settings: the restore_* switches are worth a whole screenful, so they
        // start folded away behind their own expander row.
        const items = { restoreOpen: false };

        // Set while sync() drives the switches. PopupSwitchMenuItem emits
        // 'toggled' off the underlying Switch's notify::state, so setting a
        // state programmatically fires the handlers exactly like a click would
        // — without this guard, painting the menu would write settings back.
        let syncing = false;

        // Single source of truth for how the submenu looks, including the
        // initial paint: every handler just writes to GSettings and calls this,
        // instead of patching items by hand.
        const sync = () => {
            syncing = true;
            try {
                this._syncItems(items, wmClass, title);
            } finally {
                syncing = false;
            }
            // Showing or hiding items changes how tall the submenu is, which is
            // what its scrollbar decision hangs on.
            this._syncScroll(menu, submenu);
        };

        const addSwitch = (label, onToggled) => {
            const item = new PopupMenu.PopupSwitchMenuItem(label, false);
            // Flipping a switch must not dismiss the window menu — the point of
            // this submenu is setting several flags in one go.
            // PopupSwitchMenuItem.activate() toggles and then chains up to
            // PopupBaseMenuItem.activate(), which is what closes the menu;
            // shadow it on the instance with a toggle-only version.
            item.activate = () => item.toggle();
            item.connect('toggled', (_item, active) => {
                if (syncing) return;
                onToggled(active);
                // The write may have been rejected or coerced (e.g. a missing
                // pattern), so take the switch position back from settings.
                sync();
            });
            submenu.menu.addMenuItem(item);
            return item;
        };

        items.header = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
        });
        submenu.menu.addMenuItem(items.header);

        items.manage = addSwitch('Manage this Window', active => {
            if (!active) {
                this._applyState(window, wmClass, title, 'unmanaged');
                return;
            }

            // Prefer re-enabling a rule this window already had (switched off
            // earlier, or configured in Preferences) over creating a fresh one,
            // so its customization survives an off/on round trip. Otherwise
            // rules are keyed by class, falling back to the title only when the
            // window has no class to match on.
            const { slotClass, slotTitle } = this._status(wmClass, title);
            let target;
            if (slotClass) target = 'class';
            else if (slotTitle) target = 'name';
            else target = wmClass ? 'class' : 'name';

            this._applyState(window, wmClass, title, target);
        });

        items.mode = addSwitch('Match by Window Title', active => {
            const st = this._status(wmClass, title);
            if (st.managed) {
                this._applyState(window, wmClass, title, active ? 'name' : 'class');
            } else if (st.excluded) {
                this._applyState(window, wmClass, title, active ? 'excluded-title' : 'excluded-class');
            }
        });

        items.exclude = addSwitch('Exclude from Global Defaults', active => {
            if (active) {
                const { modeIsTitle } = this._status(wmClass, title);
                const byTitle = wmClass ? modeIsTitle : true;
                this._applyState(window, wmClass, title, byTitle ? 'excluded-title' : 'excluded-class');
            } else {
                this._applyState(window, wmClass, title, 'unmanaged');
            }
        });

        items.restoreSeparator = new PopupMenu.PopupSeparatorMenuItem();
        submenu.menu.addMenuItem(items.restoreSeparator);

        // Expander for the restore_* block. Deliberately not a nested
        // PopupSubMenuMenuItem: opening one of those reports to _getTopMenu(),
        // which is the *window* menu, so it would close this submenu — the very
        // thing it lives in. Showing/hiding plain items is both simpler and
        // free of that ownership problem.
        items.restore = new PopupMenu.PopupMenuItem('Restore');
        items.restore.add_child(new St.Bin({
            style_class: 'popup-menu-item-expander',
            x_expand: true,
        }));
        items.restoreArrow = PopupMenu.arrowIcon(St.Side.RIGHT);
        items.restore.add_child(items.restoreArrow);
        // Same reason as the switches: expanding must not dismiss the menu.
        items.restore.activate = () => {
            items.restoreOpen = !items.restoreOpen;
            sync();
        };
        submenu.menu.addMenuItem(items.restore);

        for (const toggle of RESTORE_TOGGLES) {
            items[toggle.key] = addSwitch(toggle.label, active => {
                this._updateActiveConfig(wmClass, title, config => {
                    config[toggle.key] = active;
                });
            });
        }

        items.lock = addSwitch('Lock (don’t record changes)', active => {
            this._updateActiveConfig(wmClass, title, config => {
                config.locked = active;
            });
        });

        items.capture = new PopupMenu.PopupMenuItem('Save Current State Now');
        items.capture.connect('activate', () => this._captureState(window, wmClass, title));
        submenu.menu.addMenuItem(items.capture);

        submenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const moreItem = new PopupMenu.PopupMenuItem('More Options…');
        moreItem.connect('activate', () => this._openCustomize(wmClass, title));
        submenu.menu.addMenuItem(moreItem);

        // Cap the window menu's height only while our submenu is expanded, so a
        // collapsed "Deja Window" leaves GNOME's menu behaving exactly as it
        // does without the extension. This runs before PopupSubMenu.open()
        // decides whether it needs a scrollbar, which is what makes the
        // decision come out right for the initial state.
        submenu.menu.connect('open-state-changed', (_submenu, open) => {
            if (open) this._limitHeight(menu, submenu);
            else this._releaseHeight(menu);
        });

        sync();
    }

    // Bounds the window menu to the room actually available around the title
    // bar. Without this, expanding the submenu can make the menu taller than
    // the screen, and BoxPointer re-picks the side it points at on the next
    // relayout: a menu that had just flipped above a low title bar flips back
    // below it and runs off the bottom edge. Capping the height keeps it
    // fitting on the side it chose. St.ScrollView only ever scrolls when a
    // max-height is set on the *top* menu (see PopupSubMenu's own comment), so
    // the style has to go on the window menu itself, not on our submenu.
    _limitHeight(menu, submenu) {
        const source = menu.sourceActor;
        if (!source) return;

        const monitorIndex = Main.layoutManager.findIndexForActor(source);
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
        if (!workArea) return;

        const [, sourceY] = source.get_transformed_position();
        const [, sourceHeight] = source.get_transformed_size();
        const spaceAbove = sourceY - workArea.y;
        const spaceBelow = workArea.y + workArea.height - (sourceY + sourceHeight);

        const limit = Math.max(MIN_HEIGHT_LIMIT,
            Math.floor(Math.max(spaceAbove, spaceBelow)) - HEIGHT_LIMIT_MARGIN);

        menu.actor.style = `max-height: ${limit}px;`;
        this._syncScroll(menu, submenu);
    }

    // Drops the cap again, leaving GNOME's menu exactly as it found it.
    _releaseHeight(menu) {
        menu.actor.style = null;
    }

    // Re-runs PopupSubMenu's own scrollbar test. It only does that when it
    // opens ("Dynamic changes in whether we need it aren't handled properly"),
    // but our submenu also grows and shrinks while it's open.
    _syncScroll(menu, submenu) {
        // Nothing to decide while the submenu is folded away — and this also
        // keeps the initial paint from measuring a menu that isn't shown yet.
        if (!submenu.menu.isOpen) return;

        const scrollView = submenu.menu.actor;
        const [, naturalHeight] = menu.actor.get_preferred_height(-1);
        const maxHeight = menu.actor.get_theme_node().get_max_height();
        const needsScrollbar = maxHeight >= 0 && naturalHeight >= maxHeight;

        scrollView.vscrollbar_policy =
            needsScrollbar ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER;
        if (needsScrollbar) {
            scrollView.add_style_pseudo_class('scrolled');
        } else {
            scrollView.remove_style_pseudo_class('scrolled');
        }
    }

    // Repaints every item from the current settings state. Called for the
    // initial build and after each edit, so there's exactly one description of
    // what the submenu should look like for a given state.
    _syncItems(items, wmClass, title) {
        const st = this._status(wmClass, title);
        const { managed, excluded, modeIsTitle, isRegex, config } = st;

        items.header.label.text = this._headerText(st);

        items.manage.setToggleState(managed);
        items.manage.setSensitive(!isRegex);

        items.mode.setToggleState(modeIsTitle);
        // Only meaningful when there's something to re-target, and only
        // possible when both identities exist to switch between.
        items.mode.setSensitive(!isRegex && !!wmClass && !!title && (managed || excluded));

        // Excluding is about the Global Defaults fallback, which an explicit
        // rule already overrides — so it's irrelevant while managed.
        items.exclude.visible = !managed;
        items.exclude.setToggleState(excluded);

        // The restore_* flags of an explicit rule, behind their expander.
        // Deliberately hidden rather than disabled when unmanaged: the values
        // would be the Global Defaults', and editing those from a single
        // window's menu would silently change every other app's behaviour.
        // Unmanaging also folds the block back up, so re-enabling a rule always
        // starts from the short menu.
        if (!managed) items.restoreOpen = false;

        items.restoreSeparator.visible = managed;
        items.restore.visible = managed;
        items.restoreArrow.icon_name = items.restoreOpen ? 'pan-down-symbolic' : 'pan-end-symbolic';

        for (const toggle of RESTORE_TOGGLES) {
            const item = items[toggle.key];
            item.visible = managed && items.restoreOpen;
            item.setToggleState(!!config[toggle.key]);
            item.setSensitive(!toggle.dependsOn || !!config[toggle.dependsOn]);
        }

        items.lock.visible = managed;
        items.lock.setToggleState(config.locked === true);
        items.capture.visible = managed;
        // Same rationale as the prefs button: without the lock, the very next
        // window move overwrites whatever we just pinned.
        items.capture.setSensitive(config.locked === true);
    }

    // Opens Preferences, with the window's current rule pre-expanded when it
    // has one. Since prefs.js runs in a separate process, the target rule is
    // handed over via a one-shot GSettings key rather than any direct call.
    _openCustomize(wmClass, title) {
        const settings = this._extension._settings;
        if (!settings) return;

        const { activeConfig } = this._readState(wmClass, title);
        settings.set_string('prefs-highlight-target', activeConfig
            ? JSON.stringify({
                wm_class: activeConfig.wm_class,
                match_mode: activeConfig.match_mode || 'wm_class',
            })
            : '');
        this._extension.openPreferences();
    }

    // Snapshots this window's geometry into the rule's saved state. Unlike the
    // prefs button, no GSettings round-trip is needed: the menu runs inside the
    // extension process and already holds the Meta.Window.
    _captureState(window, wmClass, title) {
        const { activeConfig } = this._readState(wmClass, title);
        if (!activeConfig) return;

        const saved = this._extension.captureWindowState(window, activeConfig.wm_class);
        this._showOsd(saved ? 'document-save-symbolic' : 'dialog-error-symbolic',
            saved ? 'Window state saved' : 'Could not save window state');
    }

    // Transient on-screen confirmation (the menu closes on activation, so
    // there's nothing left to show the result in). OsdWindowManager.show()
    // changed signature in GNOME 50 — a per-monitor 'levels' map instead of a
    // leading monitor index — so pick the entry point by feature detection,
    // the same approach extension.js uses for the Meta maximize/unmaximize
    // arity differences. Level arguments are omitted on purpose: that hides
    // the progress bar, leaving just the icon and the label.
    _showOsd(iconName, label) {
        const icon = new Gio.ThemedIcon({ name: iconName });
        const manager = Main.osdWindowManager;

        if (typeof manager.showAll === 'function') {
            manager.showAll(icon, label);
        } else {
            manager.show(-1, icon, label);
        }
    }

    // Applies a mutation to the rule currently governing this window and
    // persists it. No-op when nothing explicit governs it (the restore/lock
    // switches are hidden in that case).
    _updateActiveConfig(wmClass, title, mutate) {
        const settings = this._extension._settings;
        if (!settings) return;

        const { configs, activeConfig } = this._readState(wmClass, title);
        if (!activeConfig) return;

        // activeConfig is a reference into configs, so mutating it in place is
        // enough for the re-serialization below to pick the change up.
        mutate(activeConfig);
        settings.set_string('window-app-configs', JSON.stringify(configs));
        this._extension._updateConfigs();
    }

    // Removes the (menu-managed) exclusion rules at the given indexes from
    // excludedList, highest index first so splices don't shift each other.
    // Returns true if anything was removed.
    _removeExclusions(excludedList, classIdx, titleIdx) {
        let removed = false;
        for (const idx of [classIdx, titleIdx].sort((a, b) => b - a)) {
            if (idx !== -1) {
                excludedList.splice(idx, 1);
                removed = true;
            }
        }
        return removed;
    }

    _applyState(window, wmClass, title, targetState) {
        const settings = this._extension._settings;
        if (!settings) return;

        const { configs, globalDefaults, activeConfig, slotClass, slotTitle, excludedList, excludedClassIdx, excludedTitleIdx, state } =
            this._readState(wmClass, title);

        // Nothing to do when the window is already in the requested state.
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

            if (this._removeExclusions(excludedList, excludedClassIdx, excludedTitleIdx)) {
                globalDefaults.excluded_apps = excludedList;
                defaultsChanged = true;
            }
        } else if (targetState === 'unmanaged') {
            retireActiveConfig(null);

            if (this._removeExclusions(excludedList, excludedClassIdx, excludedTitleIdx)) {
                globalDefaults.excluded_apps = excludedList;
                defaultsChanged = true;
            }
        } else if (targetState === 'excluded-class' || targetState === 'excluded-title') {
            const pattern = targetState === 'excluded-class' ? wmClass : title;
            if (!pattern) return;

            retireActiveConfig(null);

            // Excluding by class and by title are mutually exclusive for the
            // same window: drop the other one before adding the new rule.
            this._removeExclusions(excludedList, excludedClassIdx, excludedTitleIdx);
            excludedList.push({
                wm_class: pattern,
                match_mode: targetState === 'excluded-class' ? 'wm_class' : 'title',
                is_regex: false,
            });
            globalDefaults.excluded_apps = excludedList;
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
