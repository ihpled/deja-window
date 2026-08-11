import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * DejaWindowPreferences Class
 * 
 * Manages the settings and preferences UI for the Deja Window extension.
 * Allows users to add, remove, and configure application windows to manage.
 */
export default class DejaWindowPreferences extends ExtensionPreferences {
    /**
     * Fills the preferences window with the extension settings page.
     * @param {Adw.PreferencesWindow} window - The preferences window.
     */
    fillPreferencesWindow(window) {
        // Use default height
        window.set_default_size(700, 0);

        // The extension ships a custom "globe-symbolic" icon (for the Global
        // Defaults tab) that isn't part of the system icon theme, so it has
        // to be added as an extra search path before it can be referenced
        // by name below.
        const iconsPath = GLib.build_filenamev([this.path, 'icons']);
        Gtk.IconTheme.get_for_display(window.get_display()).add_search_path(iconsPath);

        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Applications',
            icon_name: 'preferences-desktop-apps-symbolic'
        });
        const group = new Adw.PreferencesGroup({
            title: 'Application Configuration',
            description: 'Add windows to manage.'
        });
        page.add(group);

        window.add(page);

        // Global Defaults gets its own tab: with per-app configs already taking
        // one full page, adding 9+ more switches plus the exclude list here made
        // the main page too long to scan at a glance.
        const defaultsPage = new Adw.PreferencesPage({
            title: 'Global Defaults',
            icon_name: 'globe-symbolic'
        }); // custom icon, see src/icons/globe-symbolic.svg and the search path added above
        window.add(defaultsPage);

        // General extension settings (currently just the top bar indicator),
        // kept separate from Global Defaults since it's about the extension
        // itself rather than window-restore behavior.
        const settingsPage = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'preferences-system-symbolic'
        });
        window.add(settingsPage);

        // Mirrors the logical bypass switch in the top bar indicator's menu
        // (functionality-enabled): same GSettings key, so toggling it here or
        // from the indicator stays in sync either way. Placed first/prominently
        // since it's the master switch for all window tracking/restore/save.
        const statusGroup = new Adw.PreferencesGroup({
            title: 'Status'
        });
        settingsPage.add(statusGroup);

        const statusRow = new Adw.ActionRow({
            title: 'Enabled',
            subtitle: 'When off, Deja Window stays installed but all window tracking, restoring and saving is bypassed.'
        });
        const statusSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('functionality-enabled', statusSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        statusRow.add_suffix(statusSwitch);
        statusGroup.add(statusRow);

        const indicatorGroup = new Adw.PreferencesGroup({
            title: 'Top Bar',
            description: 'Quickly access Deja Window settings or enable/disable the extension from the top bar.'
        });
        settingsPage.add(indicatorGroup);

        const indicatorRow = new Adw.ActionRow({
            title: 'Show Icon in Top Bar'
        });
        const indicatorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('show-indicator', indicatorSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        indicatorRow.add_suffix(indicatorSwitch);
        indicatorGroup.add(indicatorRow);

        // -- Backup & Restore Section --
        // Exports/imports the user-defined rules (window-app-configs) and the
        // Global Defaults (window-global-defaults) as a single JSON file.
        // Saved window states are intentionally excluded: they're machine- and
        // session-specific geometry, not user configuration.
        const backupGroup = new Adw.PreferencesGroup({
            title: 'Backup & Restore',
            description: 'Export your application rules and Global Defaults to a file, or import them back.'
        });
        settingsPage.add(backupGroup);

        const backupRow = new Adw.ActionRow({
            title: 'Configuration File'
        });
        backupGroup.add(backupRow);

        const exportButton = new Gtk.Button({
            label: 'Export…',
            valign: Gtk.Align.CENTER
        });
        backupRow.add_suffix(exportButton);

        const importButton = new Gtk.Button({
            label: 'Import…',
            valign: Gtk.Align.CENTER
        });
        backupRow.add_suffix(importButton);

        const showBackupError = (message) => {
            const dialog = new Adw.MessageDialog({
                heading: 'Import Failed',
                body: message,
                transient_for: window,
                modal: true
            });
            dialog.add_response('ok', 'OK');
            dialog.present();
        };

        exportButton.connect('clicked', () => {
            const data = {
                // Version marker so future format changes can be detected on import.
                deja_window_backup: 1,
                window_app_configs: getConfigs(),
                window_global_defaults: getGlobalDefaults()
            };

            const dialog = new Gtk.FileDialog({
                title: 'Export Configuration',
                initial_name: 'deja-window-backup.json'
            });
            dialog.save(window, null, (_dlg, result) => {
                try {
                    const file = dialog.save_finish(result);
                    if (!file) return;
                    file.replace_contents(
                        new TextEncoder().encode(JSON.stringify(data, null, 2)),
                        null, false, Gio.FileCreateFlags.NONE, null);
                } catch (e) {
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        console.error('Export failed:', e);
                }
            });
        });

        importButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: 'Import Configuration' });
            const filter = new Gtk.FileFilter();
            filter.add_pattern('*.json');
            dialog.set_default_filter(filter);
            dialog.open(window, null, (_dlg, result) => {
                let file;
                try {
                    file = dialog.open_finish(result);
                } catch (e) {
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        console.error('Import failed:', e);
                    return;
                }
                if (!file) return;

                let data;
                try {
                    const [ok, bytes] = file.load_contents(null);
                    if (!ok) throw new Error('Could not read file');
                    data = JSON.parse(new TextDecoder().decode(bytes));
                } catch (e) {
                    showBackupError('The selected file is not a valid Deja Window backup.');
                    return;
                }

                const importedConfigs = Array.isArray(data.window_app_configs) ? data.window_app_configs : null;
                const importedDefaults = data.window_global_defaults && typeof data.window_global_defaults === 'object'
                    ? data.window_global_defaults : null;
                if (!importedConfigs && !importedDefaults) {
                    showBackupError('The selected file does not contain any application rules or Global Defaults.');
                    return;
                }

                // One dialog covers both choices: how to handle app rules
                // (merge vs replace) and whether to also import Global Defaults.
                const confirm = new Adw.MessageDialog({
                    heading: 'Import Configuration',
                    body: importedConfigs
                        ? `The file contains ${importedConfigs.length} application rule(s).`
                        : 'The file contains no application rules.',
                    transient_for: window,
                    modal: true
                });

                const defaultsCheck = new Gtk.CheckButton({
                    label: 'Also import Global Defaults (replaces the current ones)',
                    active: !!importedDefaults,
                    sensitive: !!importedDefaults
                });
                confirm.set_extra_child(defaultsCheck);

                confirm.add_response('cancel', 'Cancel');
                if (importedConfigs) {
                    confirm.add_response('merge', 'Add to Existing Rules');
                    confirm.add_response('replace', 'Replace Existing Rules');
                    confirm.set_response_appearance('replace', Adw.ResponseAppearance.DESTRUCTIVE);
                    confirm.set_default_response('merge');
                } else {
                    confirm.add_response('merge', 'Import');
                    confirm.set_default_response('merge');
                }
                confirm.set_close_response('cancel');

                confirm.connect('response', (_dlg, response) => {
                    if (response === 'cancel') return;

                    if (importedConfigs) {
                        if (response === 'replace') {
                            saveConfigs(importedConfigs);
                        } else {
                            // Merge: imported rules win on identity conflicts
                            // (same wm_class + match_mode), existing ones are kept otherwise.
                            const existing = getConfigs();
                            importedConfigs.forEach(imported => {
                                const idx = existing.findIndex(c =>
                                    c.wm_class === imported.wm_class &&
                                    (c.match_mode || 'wm_class') === (imported.match_mode || 'wm_class'));
                                if (idx >= 0) existing[idx] = imported;
                                else existing.push(imported);
                            });
                            saveConfigs(existing);
                        }
                    }

                    if (defaultsCheck.active && importedDefaults)
                        saveGlobalDefaults({ ...getGlobalDefaults(), ...importedDefaults });
                });
                confirm.present();
            });
        });

        // -- Add New App Section --

        // Row 1: Match Settings
        const matchRow = new Adw.ActionRow({
            title: 'Match Options',
            subtitle: 'Select matching mode and regex'
        });
        group.add(matchRow);

        // Match Mode Selector
        const modeCombo = new Gtk.ComboBoxText();
        modeCombo.append('wm_class', 'WM_CLASS');
        modeCombo.append('title', 'Window Title');
        modeCombo.set_active_id('wm_class');
        modeCombo.set_valign(Gtk.Align.CENTER);
        matchRow.add_suffix(modeCombo);

        // Regex Checkbox
        const regexCheck = new Gtk.CheckButton({
            label: 'Regex',
            valign: Gtk.Align.CENTER
        });
        matchRow.add_suffix(regexCheck);

        // Row 2: Input and Add Button
        const inputRow = new Adw.ActionRow({
            title: 'Window Identifier',
            subtitle: 'Enter WM_CLASS or Window Title\nIf enabled, you can use regex like "^DevTools.*"'
        });
        group.add(inputRow);

        // Populate with known classes
        const known = settings.get_value('known-wm-classes').recursiveUnpack();

        // Opens a picker for a known WM_CLASS, filling targetEntry on selection.
        // GtkDropDown's popup is a separate xdg_popup Wayland surface, which on
        // this GTK/Mutter combination silently fails to present when the widget
        // is nested inside Adw.PreferencesPage's scrolled/clamped layout (no
        // error, it just never opens). Adw.Dialog instead overlays in the same
        // window surface as Adw.MessageDialog, which is confirmed to work here,
        // so it's used for this picker too instead of chasing the popup bug.
        const showKnownAppsPicker = (targetEntry) => {
            if (known.length === 0) return;

            const dialog = new Adw.Dialog({
                title: 'Select a Known App',
                content_width: 380,
                content_height: 480
            });

            const toolbarView = new Adw.ToolbarView();
            toolbarView.add_top_bar(new Adw.HeaderBar({ show_end_title_buttons: false }));

            const searchEntry = new Gtk.SearchEntry({
                placeholder_text: 'Search…',
                margin_start: 12, margin_end: 12, margin_top: 6, margin_bottom: 6
            });

            const listBox = new Gtk.ListBox({
                selection_mode: Gtk.SelectionMode.NONE,
                css_classes: ['boxed-list'],
                margin_start: 12, margin_end: 12, margin_bottom: 12
            });
            known.forEach(wmClass => {
                const row = new Adw.ActionRow({ title: wmClass, activatable: true });
                row.connect('activated', () => {
                    targetEntry.set_text(wmClass);
                    dialog.close();
                });
                listBox.append(row);
            });

            searchEntry.connect('search-changed', () => {
                const query = searchEntry.get_text().toLowerCase();
                let child = listBox.get_first_child();
                while (child) {
                    child.visible = !query || child.title.toLowerCase().includes(query);
                    child = child.get_next_sibling();
                }
            });

            const contentBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
            contentBox.append(searchEntry);
            contentBox.append(new Gtk.ScrolledWindow({ vexpand: true, child: listBox }));

            toolbarView.set_content(contentBox);
            dialog.set_child(toolbarView);

            // Adw.Dialog's own Escape-to-close binding fires on the entry's bubble
            // phase, but GtkSearchEntry binds Escape itself (to clear its text),
            // consuming the key first. A capture-phase controller on the dialog
            // intercepts Escape before it reaches the search entry, so cancelling
            // without picking anything always works regardless of focus.
            const escController = new Gtk.EventControllerKey();
            escController.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
            escController.connect('key-pressed', (_controller, keyval) => {
                if (keyval === Gdk.KEY_Escape) {
                    dialog.close();
                    return true;
                }
                return false;
            });
            dialog.add_controller(escController);

            dialog.present(window);

            // Focus the search entry once the dialog is actually mapped, so typing
            // filters immediately without first having to click into it.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                searchEntry.grab_focus();
                return GLib.SOURCE_REMOVE;
            });
        };

        const entry = new Gtk.Entry({
            placeholder_text: 'WM_CLASS or Title',
            hexpand: true,
            valign: Gtk.Align.CENTER
        });
        inputRow.add_suffix(entry);

        if (known.length > 0) {
            const pickAppButton = new Gtk.Button({
                icon_name: 'view-list-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Pick a known app'
            });
            pickAppButton.connect('clicked', () => showKnownAppsPicker(entry));
            inputRow.add_suffix(pickAppButton);
        }

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        inputRow.add_suffix(addButton);

        // State used by functions
        let rows = [];
        let settingsSignalId = null;

        // --- Helper Functions ---

        const getConfigs = () => {
            const json = settings.get_string('window-app-configs');
            try {
                return JSON.parse(json) || [];
            } catch (e) {
                console.error('Error parsing window-app-configs:', e);
                return [];
            }
        };

        const saveConfigs = (configs) => {
            settings.set_string('window-app-configs', JSON.stringify(configs));
        };

        // Builds an ActionRow with a single switch and wires it to onChange.
        // addFn receives the finished row so callers can decide how/where to
        // attach it (Adw.ExpanderRow.add_row vs Adw.PreferencesGroup.add) and
        // whether to track it for later removal on refresh.
        const makeSwitchRow = (addFn, title, subtitle, initialValue, onChange) => {
            const row = new Adw.ActionRow({ title });
            if (subtitle) row.set_subtitle(subtitle);
            const sw = new Gtk.Switch({
                active: !!initialValue,
                valign: Gtk.Align.CENTER
            });
            sw.connect('notify::active', () => onChange(sw.active));
            row.add_suffix(sw);
            addFn(row);
            return sw;
        };

        // Update helper to identify config by both wm_class and match_mode if possible.
        // But the previous implementation assumed wm_class uniqueness.
        // We really should pass the config index or object itself if we could, but these helpers are convenient.
        // Let's update `updateConfig` signature.
        const updateConfig = (wmClass, matchMode, key, value) => {
            const configs = getConfigs();
            // Match both class string and mode to be precise
            const config = configs.find(c => c.wm_class === wmClass && (c.match_mode || 'wm_class') === (matchMode || 'wm_class'));
            if (config) {
                config[key] = value;

                // Block signal to prevent list rebuild
                if (settingsSignalId) {
                    settings.block_signal_handler(settingsSignalId);
                }

                saveConfigs(configs);

                if (settingsSignalId) {
                    settings.unblock_signal_handler(settingsSignalId);
                }
            }
        };

        const removeConfig = (wmClass, matchMode) => {
            let configs = getConfigs();
            // Filter out the specific entry
            configs = configs.filter(c => !(c.wm_class === wmClass && (c.match_mode || 'wm_class') === (matchMode || 'wm_class')));
            saveConfigs(configs);
        };

        const addConfig = (wmClass, isRegex = false, matchMode = 'wm_class') => {
            const configs = getConfigs();
            // Check uniqueness based on both value and mode
            if (configs.find(c => c.wm_class === wmClass && c.match_mode === matchMode)) {
                return; // Already exists
            }
            configs.push({
                wm_class: wmClass, // Acts as the pattern/value
                match_mode: matchMode,
                enabled: true,
                restore_size: false,
                restore_pos: false,
                restore_maximized: false,
                restore_workspace: false,
                switch_to_workspace: false,
                restore_minimized: false,
                restore_above: false,
                restore_sticky: false,
                avoid_overlap: false,
                is_regex: isRegex,
                locked: false
            });
            saveConfigs(configs);
        };

        const onAddClicked = () => {
            const text = entry.get_text().trim();
            if (text) {
                addConfig(text, regexCheck.active, modeCombo.get_active_id());
                entry.set_text('');
                regexCheck.active = false;
                // Reset mode to default if desired, or keep last selection
            }
        };

        // Connect Add Button
        addButton.connect('clicked', onAddClicked);

        // -- List Section --
        const listGroup = new Adw.PreferencesGroup({
            title: 'Managed Windows'
        });
        page.add(listGroup);

        const refreshList = () => {
            // Capture expansion state
            const expandedStates = {};
            rows.forEach(row => {
                expandedStates[row.get_title()] = row.get_expanded();
                listGroup.remove(row);
            });
            rows = [];

            const configs = getConfigs();

            configs.forEach(config => {
                let title = config.wm_class;
                if (config.match_mode === 'title') {
                    title += ' (Title)';
                } else {
                    title += ' (Class)';
                }

                if (config.is_regex) {
                    title += ' [Regex]';
                }

                const isExpanded = expandedStates[title] || false;

                // Row stays expandable regardless of enabled state, so a
                // disabled rule's details can still be reviewed/edited; only
                // the detail toggles below (never the delete button) are
                // greyed out while disabled.
                const row = new Adw.ExpanderRow({
                    title: title,
                    expanded: isExpanded
                });
                // Identifies this row for the window menu's "Customize" action
                // (see applyHighlightTarget below), independent of the display title.
                row._dejaMatchWmClass = config.wm_class;
                row._dejaMatchMode = config.match_mode || 'wm_class';

                // Lets the rule be switched off without deleting it: same
                // effect as removing it (DejaWindowExtension._getConfigForWindow
                // skips disabled rules), but its customization is kept and the
                // switch can be flipped back on to restore it. A plain suffix
                // switch (rather than AdwExpanderRow's own enable-expansion) so
                // it controls our "enabled" flag without also locking the row
                // from being expanded while off.
                const enabledSwitch = new Gtk.Switch({
                    active: config.enabled !== false,
                    valign: Gtk.Align.CENTER
                });
                row.add_suffix(enabledSwitch);

                const detailRows = [];
                const addAppRow = (title, subtitle, key, initialValue) => {
                    let detailRow;
                    makeSwitchRow(r => { detailRow = r; row.add_row(r); }, title, subtitle, initialValue,
                        value => updateConfig(config.wm_class, config.match_mode, key, value));
                    detailRows.push(detailRow);
                };

                addAppRow('Locked - window updates/changes are not saved', null, 'locked', config.locked || false);
                addAppRow('Restore Size', null, 'restore_size', config.restore_size);
                addAppRow('Restore Position', null, 'restore_pos', config.restore_pos);
                addAppRow('Restore Maximized', null, 'restore_maximized', config.restore_maximized || false);
                addAppRow('Restore Workspace', null, 'restore_workspace', config.restore_workspace || false);
                addAppRow('Switch to Workspace', 'Activate the workspace where the window is restored',
                    'switch_to_workspace', config.switch_to_workspace || false);
                addAppRow('Restore Minimized', null, 'restore_minimized', config.restore_minimized || false);
                addAppRow('Restore Always on Top', null, 'restore_above', config.restore_above || false);
                addAppRow('Restore Always on Visible Workspace', null, 'restore_sticky', config.restore_sticky || false);
                addAppRow('Avoid Overlap for Additional Windows', null, 'avoid_overlap', config.avoid_overlap !== false);

                detailRows.forEach(r => { r.sensitive = enabledSwitch.active; });
                enabledSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, config.match_mode, 'enabled', enabledSwitch.active);
                    detailRows.forEach(r => { r.sensitive = enabledSwitch.active; });
                });

                // Delete Button
                const deleteRow = new Adw.ActionRow({
                    title: 'Remove Configuration'
                });
                const deleteBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    css_classes: ['destructive-action'],
                    valign: Gtk.Align.CENTER
                });
                deleteBtn.connect('clicked', () => {
                    removeConfig(config.wm_class, config.match_mode);
                });
                deleteRow.add_suffix(deleteBtn);
                row.add_row(deleteRow);

                listGroup.add(row);
                rows.push(row);
            });
        };

        // Initial load
        refreshList();

        // Listen for external changes (e.g. manual dconf edits)
        settingsSignalId = settings.connect('changed::window-app-configs', refreshList);

        // Consumes the one-shot signal set by the window menu's "Customize" action:
        // switches to this page and expands the matching rule's row. Cleared
        // right after reading so it doesn't re-trigger on a later refresh/open.
        let prefsHighlightSignalId = null;
        const applyHighlightTarget = () => {
            const raw = settings.get_string('prefs-highlight-target');
            if (!raw) return;

            let target = null;
            try {
                target = JSON.parse(raw);
            } catch (e) {
                target = null;
            }

            settings.set_string('prefs-highlight-target', '');
            if (!target || !target.wm_class) return;

            const matchMode = target.match_mode || 'wm_class';
            const row = rows.find(r => r._dejaMatchWmClass === target.wm_class && r._dejaMatchMode === matchMode);
            if (!row) return;

            window.set_visible_page(page);
            row.set_expanded(true);
            row.grab_focus();
        };
        applyHighlightTarget();
        prefsHighlightSignalId = settings.connect('changed::prefs-highlight-target', applyHighlightTarget);

        // -- Global Defaults Section --
        // Applied automatically to every NORMAL window with no matching rule above.
        // Kept as a single, always-present group (not per-config), backed by its own
        // GSettings key so it doesn't interfere with per-app config identity.

        const DEFAULT_GLOBAL_DEFAULTS = {
            enabled: false,
            restore_size: false,
            restore_pos: false,
            restore_maximized: false,
            restore_workspace: false,
            switch_to_workspace: false,
            restore_minimized: false,
            restore_above: false,
            restore_sticky: false,
            avoid_overlap: true,
            locked: false,
            excluded_wm_classes: []
        };

        const getGlobalDefaults = () => {
            const json = settings.get_string('window-global-defaults');
            try {
                return { ...DEFAULT_GLOBAL_DEFAULTS, ...(JSON.parse(json) || {}) };
            } catch (e) {
                console.error('Error parsing window-global-defaults:', e);
                return { ...DEFAULT_GLOBAL_DEFAULTS };
            }
        };

        const saveGlobalDefaults = (defaults) => {
            settings.set_string('window-global-defaults', JSON.stringify(defaults));
        };

        let globalDefaultsSignalId = null;

        // Used by switches: writes a single field, blocking our own refresh
        // (switches already reflect the new value; no need to rebuild the section).
        const updateGlobalDefaults = (key, value) => {
            const defaults = getGlobalDefaults();
            defaults[key] = value;

            if (globalDefaultsSignalId) settings.block_signal_handler(globalDefaultsSignalId);
            saveGlobalDefaults(defaults);
            if (globalDefaultsSignalId) settings.unblock_signal_handler(globalDefaultsSignalId);
        };

        // Used by the exclude list: a row needs to appear/disappear, so let the
        // changed:: signal trigger a full section rebuild instead of blocking it.
        const removeExcluded = (wmClass) => {
            const defaults = getGlobalDefaults();
            defaults.excluded_wm_classes = (defaults.excluded_wm_classes || []).filter(c => c !== wmClass);
            saveGlobalDefaults(defaults);
        };

        const addExcluded = (wmClass) => {
            const defaults = getGlobalDefaults();
            const excluded = defaults.excluded_wm_classes || [];
            if (!wmClass || excluded.includes(wmClass)) return;
            excluded.push(wmClass);
            defaults.excluded_wm_classes = excluded;
            saveGlobalDefaults(defaults);
        };

        const globalDefaultsGroup = new Adw.PreferencesGroup({
            title: 'Global Defaults',
            description: 'Applied automatically to every normal window with no rule above. A rule above always takes priority.'
        });
        defaultsPage.add(globalDefaultsGroup);

        const excludeGroup = new Adw.PreferencesGroup({
            title: 'Excluded Apps',
            description: 'These apps are never managed by Global Defaults, even when enabled.'
        });
        defaultsPage.add(excludeGroup);

        const excludeInputRow = new Adw.ActionRow({
            title: 'Exclude an App',
            subtitle: 'Enter its WM_CLASS'
        });
        excludeGroup.add(excludeInputRow);

        const excludeEntry = new Gtk.Entry({
            placeholder_text: 'WM_CLASS',
            hexpand: true,
            valign: Gtk.Align.CENTER
        });
        excludeInputRow.add_suffix(excludeEntry);

        if (known.length > 0) {
            const pickExcludedAppButton = new Gtk.Button({
                icon_name: 'view-list-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Pick a known app'
            });
            pickExcludedAppButton.connect('clicked', () => showKnownAppsPicker(excludeEntry));
            excludeInputRow.add_suffix(pickExcludedAppButton);
        }

        const excludeAddButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        excludeInputRow.add_suffix(excludeAddButton);
        excludeAddButton.connect('clicked', () => {
            const text = excludeEntry.get_text().trim();
            if (text) {
                addExcluded(text);
                excludeEntry.set_text('');
            }
        });

        let globalDefaultsRows = [];
        let excludeRows = [];

        // Every row below "Enabled" (including the whole Excluded Apps group)
        // only matters while Global Defaults itself is on, so grey them out
        // together with it. Index 0 in globalDefaultsRows is the "Enabled" row
        // itself, which must stay interactive so the section can be turned
        // back on.
        const updateSectionSensitivity = (active) => {
            globalDefaultsRows.slice(1).forEach(row => { row.sensitive = active; });
            excludeGroup.sensitive = active;
        };

        const refreshGlobalDefaultsSection = () => {
            globalDefaultsRows.forEach(row => globalDefaultsGroup.remove(row));
            globalDefaultsRows = [];
            excludeRows.forEach(row => excludeGroup.remove(row));
            excludeRows = [];

            const defaults = getGlobalDefaults();

            // Enabled switch, gated behind a confirmation dialog since it changes
            // the risk model for every installed app at once, not just one the
            // user has already tested via an explicit per-app rule.
            const enabledRow = new Adw.ActionRow({
                title: 'Enabled',
                subtitle: 'Manage every normal window that has no rule above (experimental)'
            });
            const enabledSwitch = new Gtk.Switch({ active: defaults.enabled, valign: Gtk.Align.CENTER });
            let suppressToggle = false;
            enabledSwitch.connect('notify::active', () => {
                if (suppressToggle) return;

                if (!enabledSwitch.active) {
                    // Disabling is the safe direction: no confirmation needed.
                    updateGlobalDefaults('enabled', false);
                    updateSectionSensitivity(false);
                    return;
                }

                const dialog = new Adw.MessageDialog({
                    heading: 'Enable Global Defaults?',
                    body: 'This will manage every normal window of every application that doesn’t already have its own rule above. It is an experimental feature. Some apps may not handle programmatic resizing or repositioning well and could become unstable. You can add misbehaving apps to the exclude list below at any time.',
                    transient_for: window,
                    modal: true
                });
                dialog.add_response('cancel', 'Cancel');
                dialog.add_response('enable', 'Enable');
                dialog.set_response_appearance('enable', Adw.ResponseAppearance.SUGGESTED);
                dialog.set_default_response('cancel');
                dialog.set_close_response('cancel');
                dialog.connect('response', (_dlg, response) => {
                    if (response === 'enable') {
                        updateGlobalDefaults('enabled', true);
                        updateSectionSensitivity(true);
                    } else {
                        suppressToggle = true;
                        enabledSwitch.active = false;
                        suppressToggle = false;
                    }
                });
                dialog.present();
            });
            enabledRow.add_suffix(enabledSwitch);
            globalDefaultsGroup.add(enabledRow);
            globalDefaultsRows.push(enabledRow);

            const addDefaultRow = (title, subtitle, key, initialValue) => {
                makeSwitchRow(r => {
                    globalDefaultsGroup.add(r);
                    globalDefaultsRows.push(r);
                }, title, subtitle, initialValue, value => updateGlobalDefaults(key, value));
            };

            addDefaultRow('Locked - window updates/changes are not saved', null, 'locked', defaults.locked);
            addDefaultRow('Restore Size', null, 'restore_size', defaults.restore_size);
            addDefaultRow('Restore Position', null, 'restore_pos', defaults.restore_pos);
            addDefaultRow('Restore Maximized', null, 'restore_maximized', defaults.restore_maximized);
            addDefaultRow('Restore Workspace', null, 'restore_workspace', defaults.restore_workspace);
            addDefaultRow('Switch to Workspace', 'Activate the workspace where the window is restored',
                'switch_to_workspace', defaults.switch_to_workspace);
            addDefaultRow('Restore Minimized', null, 'restore_minimized', defaults.restore_minimized);
            addDefaultRow('Restore Always on Top', null, 'restore_above', defaults.restore_above);
            addDefaultRow('Restore Always on Visible Workspace', null, 'restore_sticky', defaults.restore_sticky);
            addDefaultRow('Avoid Overlap for Additional Windows', null, 'avoid_overlap', defaults.avoid_overlap);

            (defaults.excluded_wm_classes || []).forEach(wmClass => {
                const excludedRow = new Adw.ActionRow({ title: wmClass });
                const removeBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    css_classes: ['destructive-action'],
                    valign: Gtk.Align.CENTER
                });
                removeBtn.connect('clicked', () => removeExcluded(wmClass));
                excludedRow.add_suffix(removeBtn);
                excludeGroup.add(excludedRow);
                excludeRows.push(excludedRow);
            });

            updateSectionSensitivity(defaults.enabled);
        };

        // Initial load
        refreshGlobalDefaultsSection();

        // Listen for external changes (e.g. manual dconf edits, or our own
        // exclude-list add/remove which is intentionally left unblocked above)
        globalDefaultsSignalId = settings.connect('changed::window-global-defaults', refreshGlobalDefaultsSection);

        // Cleanup on window close
        window.connect('close-request', () => {
            if (settingsSignalId) {
                settings.disconnect(settingsSignalId);
                settingsSignalId = null;
            }
            if (globalDefaultsSignalId) {
                settings.disconnect(globalDefaultsSignalId);
                globalDefaultsSignalId = null;
            }
            if (prefsHighlightSignalId) {
                settings.disconnect(prefsHighlightSignalId);
                prefsHighlightSignalId = null;
            }
            rows = [];
            globalDefaultsRows = [];
            excludeRows = [];
        });
    }
}
