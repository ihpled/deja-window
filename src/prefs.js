import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// The restore options, in the order they're shown, shared by per-app rules and
// Global Defaults — the same set and the same short labels as the window menu's
// "Restore" section (see windowMenu.js RESTORE_TOGGLES), since both edit the
// same fields. 'dependsOn' marks an option that only refines another one: it's
// greyed out while its parent is off, and left out of the section's summary so
// that stays a list of what actually gets restored.
const RESTORE_OPTIONS = [
    { key: 'restore_size', label: 'Size' },
    { key: 'restore_pos', label: 'Position' },
    {
        key: 'avoid_overlap',
        label: 'Avoid Overlap for Additional Windows',
        subtitle: 'Offset this window when another one of the same app already sits at the restored position',
        dependsOn: 'restore_pos',
        defaultOn: true,
    },
    { key: 'restore_maximized', label: 'Maximized' },
    { key: 'restore_workspace', label: 'Workspace' },
    {
        key: 'switch_to_workspace',
        label: 'Switch to Workspace',
        subtitle: 'Activate the workspace where the window is restored',
        dependsOn: 'restore_workspace',
    },
    { key: 'restore_minimized', label: 'Minimized' },
    { key: 'restore_above', label: 'Always on Top' },
    { key: 'restore_sticky', label: 'On All Workspaces' },
];

// Keeps the collapsed "Restore" row informative: what this rule actually
// restores, or why it does nothing.
const MAX_RESTORE_SUMMARY = 52;

function restoreSummary(values) {
    const primary = RESTORE_OPTIONS.filter(option => !option.dependsOn);
    const active = primary.filter(option => !!values[option.key]);

    if (active.length === 0) return 'Nothing — the window is tracked but never restored';
    if (active.length === primary.length) return 'Everything';

    const text = active.map(option => option.label).join(', ');
    return text.length > MAX_RESTORE_SUMMARY
        ? `${text.slice(0, MAX_RESTORE_SUMMARY - 1)}…`
        : text;
}

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

        // Fixes the arrow of a nested Adw.ExpanderRow (the per-rule "Restore"
        // section inside a rule's own expander). Adwaita rotates the arrow with
        // a *descendant* selector — `row.expander:checked image.expander-row-arrow`
        // — so expanding the outer rule row also paints every arrow below it as
        // expanded (rotated + accent-coloured), whatever the inner row's real
        // state is. Restore the collapsed look for any expander row that isn't
        // itself checked; the extra `row.expander` ancestor plus `:not(:checked)`
        // outweighs Adwaita's rule on specificity, so it only ever applies to
        // nested, collapsed rows.
        const display = window.get_display();
        const arrowFixProvider = new Gtk.CssProvider();
        const arrowFixCss = `
            row.expander row.expander:not(:checked) image.expander-row-arrow {
                color: inherit;
                opacity: 0.55;
            }
            row.expander row.expander:not(:checked) image.expander-row-arrow:dir(ltr) {
                -gtk-icon-transform: rotate(0.5turn);
            }
            row.expander row.expander:not(:checked) image.expander-row-arrow:dir(rtl) {
                -gtk-icon-transform: rotate(-0.5turn);
            }
        `;
        // load_from_string only exists from GTK 4.12 on; GNOME 46's GTK 4.14 has
        // it, but keep the byte-based fallback for the older end of the range.
        if (arrowFixProvider.load_from_string) {
            arrowFixProvider.load_from_string(arrowFixCss);
        } else {
            arrowFixProvider.load_from_data(new TextEncoder().encode(arrowFixCss), -1);
        }
        Gtk.StyleContext.add_provider_for_display(
            display, arrowFixProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

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
            title: 'Active',
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
            // Escaped: Adw.PreferencesGroup titles are parsed as Pango markup,
            // and a bare ampersand makes the whole title fail to render.
            title: 'Backup &amp; Restore',
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

        // Populate with known classes/titles (recorded by the extension side)
        const known = settings.get_value('known-wm-classes').recursiveUnpack();
        const knownTitles = settings.get_value('known-window-titles').recursiveUnpack();

        // Opens a picker for a known WM_CLASS, filling targetEntry on selection.
        // GtkDropDown's popup is a separate xdg_popup Wayland surface, which on
        // this GTK/Mutter combination silently fails to present when the widget
        // is nested inside Adw.PreferencesPage's scrolled/clamped layout (no
        // error, it just never opens). Adw.Dialog instead overlays in the same
        // window surface as Adw.MessageDialog, which is confirmed to work here,
        // so it's used for this picker too instead of chasing the popup bug.
        // `items` lets callers choose which list to show (WM_CLASSes vs titles).
        const showKnownAppsPicker = (targetEntry, items = known) => {
            if (items.length === 0) return;

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
            items.forEach(item => {
                const row = new Adw.ActionRow({ title: item, activatable: true });
                row.connect('activated', () => {
                    targetEntry.set_text(item);
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

            // Click-outside-to-dismiss, which Adw.Dialog doesn't do on its own.
            // The dialog widget spans the whole parent window (the dimmed area
            // is part of it, wrapped in a GtkWindowHandle), so a capture-phase
            // click gesture on it sees every press and only has to tell the two
            // regions apart: presses inside the sheet are left alone, presses
            // outside close the picker. Offered here and not in "Edit Matching"
            // on purpose — this dialog only picks a value, so a stray click
            // outside it can't throw away anything the user typed.
            const dismissGesture = new Gtk.GestureClick();
            dismissGesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
            dismissGesture.connect('pressed', (gesture, _nPress, x, y) => {
                const [ok, bounds] = toolbarView.compute_bounds(dialog);
                if (!ok) return;

                const inside = x >= bounds.origin.x && y >= bounds.origin.y &&
                    x <= bounds.origin.x + bounds.size.width &&
                    y <= bounds.origin.y + bounds.size.height;
                if (inside) return;

                // Claim it so the press doesn't also start dragging the window
                // by the handle behind the dimming.
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
                dialog.close();
            });
            dialog.add_controller(dismissGesture);

            dialog.present(window);

            // Focus the search entry once the dialog is actually mapped, so typing
            // filters immediately without first having to click into it.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                searchEntry.grab_focus();
                return GLib.SOURCE_REMOVE;
            });
        };

        // The "Matching" block — Match By / Regular Expression / Pattern — used
        // by every surface that describes what a rule matches: the Applications
        // tab's add form, the Global Defaults exclude form and a rule's "Edit
        // Matching" dialog. One builder so creating a rule and editing one later
        // read the same way, with the same wording and the same picker. Rows are
        // appended to `group`; the returned patternRow lets callers pack an extra
        // button (Add) next to the entry, and reset() clears the form after use.
        const buildMatchingRows = (targetGroup, { pattern = '', mode = 'wm_class', isRegex = false } = {}) => {
            // Two linked toggles instead of a Gtk.ComboBoxText: with only two
            // modes both are visible at a glance and switching takes one click.
            // It also avoids the combo's popup, whose pointer grab swallowed the
            // first click on the pattern row's buttons when the mode had just
            // been changed — the click only dismissed the closing popup.
            const modeRow = new Adw.ActionRow({ title: 'Match By' });
            const modeBox = new Gtk.Box({
                valign: Gtk.Align.CENTER,
                css_classes: ['linked']
            });
            const classToggle = new Gtk.ToggleButton({
                label: 'WM_CLASS',
                active: mode !== 'title'
            });
            const titleToggle = new Gtk.ToggleButton({
                label: 'Window Title',
                group: classToggle,
                active: mode === 'title'
            });
            modeBox.append(classToggle);
            modeBox.append(titleToggle);
            modeRow.add_suffix(modeBox);
            targetGroup.add(modeRow);

            const regexRow = new Adw.ActionRow({
                title: 'Regular Expression',
                subtitle: 'Treat the pattern as a regex, e.g. "^DevTools.*"'
            });
            const regexSwitch = new Gtk.Switch({
                active: !!isRegex,
                valign: Gtk.Align.CENTER
            });
            regexRow.add_suffix(regexSwitch);
            targetGroup.add(regexRow);

            const patternRow = new Adw.ActionRow({ title: 'Pattern' });
            const patternEntry = new Gtk.Entry({
                text: pattern,
                placeholder_text: 'WM_CLASS or Title',
                hexpand: true,
                valign: Gtk.Align.CENTER
            });
            patternRow.add_suffix(patternEntry);

            const getMode = () => titleToggle.active ? 'title' : 'wm_class';

            if (known.length > 0 || knownTitles.length > 0) {
                const pickButton = new Gtk.Button({
                    icon_name: 'view-list-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Pick a known app'
                });
                // Shows WM_CLASSes or window titles, following the mode picked
                // in the row above.
                pickButton.connect('clicked', () => {
                    showKnownAppsPicker(patternEntry,
                        getMode() === 'title' ? knownTitles : known);
                });
                patternRow.add_suffix(pickButton);
            }
            targetGroup.add(patternRow);

            return {
                patternRow,
                patternEntry,
                regexSwitch,
                getMode,
                reset: () => {
                    patternEntry.set_text('');
                    regexSwitch.active = false;
                    classToggle.active = true;
                }
            };
        };

        const addMatching = buildMatchingRows(group);

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
            tooltip_text: 'Add this rule'
        });
        addMatching.patternRow.add_suffix(addButton);

        // State used by functions
        let rows = [];
        let settingsSignalId = null;
        let captureSignalId = null;
        let captureTimeoutId = 0;

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
        // whether to track it for later removal on refresh. extraSuffix, when
        // given, is packed to the left of the switch (suffixes are laid out in
        // insertion order), keeping the switch itself rightmost as usual.
        const makeSwitchRow = (addFn, title, subtitle, initialValue, onChange, extraSuffix = null) => {
            const row = new Adw.ActionRow({ title });
            if (subtitle) row.set_subtitle(subtitle);
            const sw = new Gtk.Switch({
                active: !!initialValue,
                valign: Gtk.Align.CENTER
            });
            sw.connect('notify::active', () => onChange(sw.active));
            if (extraSuffix) row.add_suffix(extraSuffix);
            row.add_suffix(sw);
            addFn(row);
            return sw;
        };

        // Builds the "Restore" block shared by per-app rules and Global
        // Defaults: one expander holding every restore option, so both places
        // read the same way as the window menu instead of a flat wall of
        // switches. `values` supplies the current state, `onChange(key, value)`
        // persists a single field. Returns the expander; it keeps its own
        // subtitle and the greying of dependent options in sync.
        const buildRestoreSection = (values, onChange) => {
            const expander = new Adw.ExpanderRow({
                title: 'Restore',
                subtitle: restoreSummary(values),
            });

            const switches = {};
            const optionRows = [];

            const sync = () => {
                expander.set_subtitle(restoreSummary(values));
                optionRows.forEach(({ row, dependsOn }) => {
                    row.sensitive = !dependsOn || switches[dependsOn].active;
                });
            };

            RESTORE_OPTIONS.forEach(option => {
                const initial = values[option.key] !== undefined
                    ? !!values[option.key]
                    : !!option.defaultOn;

                let optionRow;
                switches[option.key] = makeSwitchRow(
                    r => { optionRow = r; expander.add_row(r); },
                    option.label, option.subtitle || null, initial,
                    value => {
                        values[option.key] = value;
                        onChange(option.key, value);
                        sync();
                    });
                optionRows.push({ row: optionRow, dependsOn: option.dependsOn });
            });

            sync();
            return expander;
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

        // Rewrites what an existing rule matches (pattern, mode, regex). This is
        // the rule's identity — window-app-states is keyed by the pattern and
        // every helper here looks configs up by (pattern, mode) — so it can't go
        // through updateConfig: the saved geometry has to follow the rule to its
        // new key, and the new identity must stay unique. Returns null on
        // success, or a reason string for the caller to report.
        const updateConfigMatching = (oldPattern, oldMode, newPattern, newMode, newIsRegex) => {
            if (!newPattern) return 'The pattern cannot be empty';

            if (newIsRegex) {
                try {
                    new RegExp(newPattern);
                } catch (e) {
                    return `Invalid regular expression: ${e.message}`;
                }
            }

            const configs = getConfigs();
            const config = configs.find(c =>
                c.wm_class === oldPattern && (c.match_mode || 'wm_class') === oldMode);
            if (!config) return 'This rule no longer exists';

            const identityChanged = newPattern !== oldPattern || newMode !== oldMode;
            if (identityChanged && configs.some(c => c !== config &&
                c.wm_class === newPattern && (c.match_mode || 'wm_class') === newMode)) {
                return 'Another rule already matches that';
            }

            config.wm_class = newPattern;
            config.match_mode = newMode;
            config.is_regex = newIsRegex;
            saveConfigs(configs);

            if (newPattern !== oldPattern) {
                migrateSavedState(oldPattern, newPattern, configs);
            }
            return null;
        };

        // Moves a rule's saved geometry to its new key, so renaming a pattern
        // doesn't silently reset the window's remembered size/position. Never
        // overwrites state that's already there, and leaves the old entry alone
        // if some other rule still matches on that pattern (states are keyed by
        // pattern only, so two rules differing just by match_mode share one).
        const migrateSavedState = (oldKey, newKey, configs) => {
            let states = {};
            try {
                states = JSON.parse(settings.get_string('window-app-states')) || {};
            } catch (e) {
                return;
            }

            if (!states[oldKey] || states[newKey]) return;

            states[newKey] = states[oldKey];
            if (!configs.some(c => c.wm_class === oldKey)) {
                delete states[oldKey];
            }
            settings.set_string('window-app-states', JSON.stringify(states));
        };

        const removeConfig = (wmClass, matchMode) => {
            let configs = getConfigs();
            // Filter out the specific entry
            configs = configs.filter(c => !(c.wm_class === wmClass && (c.match_mode || 'wm_class') === (matchMode || 'wm_class')));
            saveConfigs(configs);
        };

        // Returns null on success, or a reason string for the caller to report —
        // same contract as updateConfigMatching, so creating a rule rejects the
        // same input the "Edit Matching" dialog would.
        const addConfig = (wmClass, isRegex = false, matchMode = 'wm_class') => {
            if (isRegex) {
                try {
                    new RegExp(wmClass);
                } catch (e) {
                    return `Invalid regular expression: ${e.message}`;
                }
            }

            const configs = getConfigs();
            // Check uniqueness based on both value and mode
            if (configs.find(c => c.wm_class === wmClass && (c.match_mode || 'wm_class') === matchMode)) {
                return 'A rule already matches that';
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
            return null;
        };

        const onAddClicked = () => {
            const text = addMatching.patternEntry.get_text().trim();
            if (!text) return;

            const error = addConfig(text, addMatching.regexSwitch.active, addMatching.getMode());
            if (error) {
                // Leave the form filled in so the pattern can be corrected.
                showToast(error);
                return;
            }
            addMatching.reset();
        };

        // Connect Add Button
        addButton.connect('clicked', onAddClicked);
        addMatching.patternEntry.connect('activate', onAddClicked);

        // -- "Save current window state" plumbing --
        // This process has no access to Meta windows, so the per-rule capture
        // button asks the extension over a GSettings key: we write the request,
        // the extension answers on the same key by adding a 'status' field, and
        // we consume that reply (showing a toast) and clear the key.

        const showToast = (text) => {
            if (typeof window.add_toast === 'function') {
                window.add_toast(new Adw.Toast({ title: text, timeout: 3 }));
            } else {
                console.log(`[DejaWindow] ${text}`);
            }
        };

        const cancelCaptureTimeout = () => {
            if (captureTimeoutId) {
                GLib.source_remove(captureTimeoutId);
                captureTimeoutId = 0;
            }
        };

        const requestCapture = (wmClass, matchMode) => {
            cancelCaptureTimeout();
            settings.set_string('capture-state-request', JSON.stringify({
                wm_class: wmClass,
                match_mode: matchMode || 'wm_class'
            }));

            // No reply ever arrives if the extension isn't actually running
            // (disabled, or shell reloaded since): give up after a moment so the
            // button doesn't just look broken, and drop the stale request.
            captureTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                captureTimeoutId = 0;
                settings.set_string('capture-state-request', '');
                showToast('Deja Window is not running, so the current window state could not be read.');
                return GLib.SOURCE_REMOVE;
            });
        };

        const onCaptureReply = () => {
            const raw = settings.get_string('capture-state-request');
            if (!raw) return;

            let reply = null;
            try {
                reply = JSON.parse(raw);
            } catch (e) {
                reply = null;
            }
            // No 'status' field: this is our own request, still unanswered.
            if (!reply || !reply.status) return;

            cancelCaptureTimeout();
            settings.set_string('capture-state-request', '');

            if (reply.status !== 'saved') {
                showToast(reply.status === 'no-window'
                    ? `No open window matches “${reply.wm_class}”.`
                    : `No rule found for “${reply.wm_class}”.`);
                return;
            }

            showToast(`Current window state saved for “${reply.wm_class}”.`);
        };

        // A request left over from a previous session would make the next
        // identical one a no-op, since GSettings only emits 'changed' when the
        // value actually differs — so start from a clean slate.
        settings.set_string('capture-state-request', '');
        captureSignalId = settings.connect('changed::capture-state-request', onCaptureReply);

        // One-line description of what a rule matches, shown on its "Matching" row.
        const matchSummary = (config) => {
            const parts = [config.wm_class,
                (config.match_mode === 'title') ? 'Window Title' : 'Window Class'];
            if (config.is_regex) parts.push('Regex');
            return parts.join('  ·  ');
        };

        // Identity of the rule to re-expand after the next refresh, so editing a
        // rule's matching (which renames its row) doesn't collapse it.
        let expandTarget = null;

        // Editor for a rule's matching, offered per-rule so a rule created from
        // the window menu — which always picks an exact class/title match — can
        // be turned into a title or regex rule afterwards, instead of having to
        // delete it and lose its options. Dialog rather than inline rows: the
        // three fields only make sense applied together, and it keeps a rule's
        // expander from growing another block of controls.
        const showMatchDialog = (config) => {
            const oldPattern = config.wm_class;
            const oldMode = config.match_mode || 'wm_class';

            const dialog = new Adw.Dialog({ title: 'Edit Matching', content_width: 460 });

            const headerBar = new Adw.HeaderBar({ show_end_title_buttons: false });
            const cancelButton = new Gtk.Button({ label: 'Cancel' });
            const saveButton = new Gtk.Button({ label: 'Save', css_classes: ['suggested-action'] });
            headerBar.pack_start(cancelButton);
            headerBar.pack_end(saveButton);

            const editGroup = new Adw.PreferencesGroup({
                margin_start: 12, margin_end: 12, margin_top: 12, margin_bottom: 12,
                description: ''
            });

            const matching = buildMatchingRows(editGroup, {
                pattern: oldPattern,
                mode: oldMode,
                isRegex: config.is_regex
            });

            const apply = () => {
                const newPattern = matching.patternEntry.get_text().trim();
                const newMode = matching.getMode();

                // Set before the write: saving triggers the list rebuild through
                // the settings handler, which may run before this returns, and
                // that rebuild is what consumes the target.
                expandTarget = { wm_class: newPattern, match_mode: newMode };

                const error = updateConfigMatching(oldPattern, oldMode, newPattern, newMode,
                    matching.regexSwitch.active);
                if (error) {
                    // Keep the dialog open so the entry can be corrected.
                    expandTarget = null;
                    showToast(error);
                    return;
                }
                dialog.close();
            };

            saveButton.connect('clicked', apply);
            matching.patternEntry.connect('activate', apply);
            cancelButton.connect('clicked', () => dialog.close());

            const toolbarView = new Adw.ToolbarView();
            toolbarView.add_top_bar(headerBar);
            toolbarView.set_content(editGroup);
            dialog.set_child(toolbarView);
            dialog.present(window);
        };

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

                const isExpanded = expandedStates[title] ||
                    (expandTarget !== null &&
                     expandTarget.wm_class === config.wm_class &&
                     expandTarget.match_mode === (config.match_mode || 'wm_class'));

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

                // What this rule matches, editable after the fact. Kept out of
                // detailRows on purpose: like the delete button, it stays usable
                // while the rule is switched off.
                const matchRow = new Adw.ActionRow({
                    title: 'Matching',
                    subtitle: matchSummary(config)
                });
                const editMatchButton = new Gtk.Button({
                    icon_name: 'document-edit-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Change what this rule matches'
                });
                editMatchButton.connect('clicked', () => showMatchDialog(config));
                matchRow.add_suffix(editMatchButton);
                row.add_row(matchRow);

                const detailRows = [];
                const addAppRow = (title, subtitle, key, initialValue, extraSuffix = null) => {
                    let detailRow;
                    const sw = makeSwitchRow(r => { detailRow = r; row.add_row(r); }, title, subtitle, initialValue,
                        value => updateConfig(config.wm_class, config.match_mode, key, value), extraSuffix);
                    detailRows.push(detailRow);
                    return sw;
                };

                // Pins this rule to the live geometry of the app's current window,
                // instead of having to move the window and wait for the automatic
                // (debounced) save. The extension does the actual snapshot, see
                // requestCapture above.
                const captureButton = new Gtk.Button({
                    icon_name: 'document-save-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Save the current window position/size as the fixed state (requires Locked)'
                });
                captureButton.connect('clicked', () => requestCapture(config.wm_class, config.match_mode));

                const restoreSection = buildRestoreSection(config,
                    (key, value) => updateConfig(config.wm_class, config.match_mode, key, value));
                row.add_row(restoreSection);
                detailRows.push(restoreSection);

                const lockedSwitch = addAppRow('Locked', 'Freeze the saved state: window changes are no longer recorded',
                    'locked', config.locked || false, captureButton);

                // Only offered while the rule is locked: without the lock the very
                // next move/resize of the window would overwrite the state just
                // captured, so the button would be pointless.
                captureButton.sensitive = lockedSwitch.active;
                lockedSwitch.connect('notify::active', () => {
                    captureButton.sensitive = lockedSwitch.active;
                });

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

            expandTarget = null;
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
            excluded_apps: []
        };

        const getGlobalDefaults = () => {
            const json = settings.get_string('window-global-defaults');
            try {
                const defaults = { ...DEFAULT_GLOBAL_DEFAULTS, ...(JSON.parse(json) || {}) };
                // Drop the pre-excluded_apps key if still present in stored JSON.
                delete defaults.excluded_wm_classes;
                return defaults;
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

        // Excluded apps are stored as rule objects in excluded_apps
        // ({wm_class: pattern, match_mode, is_regex}), mirroring per-app configs.
        const getExcludedApps = (defaults) => [...(defaults.excluded_apps || [])];

        const saveExcludedApps = (defaults, apps) => {
            defaults.excluded_apps = apps;
            saveGlobalDefaults(defaults);
        };

        // Used by the exclude list: a row needs to appear/disappear, so let the
        // changed:: signal trigger a full section rebuild instead of blocking it.
        const removeExcluded = (wmClass, matchMode, isRegex) => {
            const defaults = getGlobalDefaults();
            const apps = getExcludedApps(defaults).filter(a =>
                !(a.wm_class === wmClass && (a.match_mode || 'wm_class') === (matchMode || 'wm_class') && !!a.is_regex === !!isRegex));
            saveExcludedApps(defaults, apps);
        };

        // Same null-or-reason contract as addConfig, so a bad pattern is reported
        // here the way it is on the Applications tab instead of silently doing
        // nothing.
        const addExcluded = (wmClass, isRegex = false, matchMode = 'wm_class') => {
            if (!wmClass) return 'The pattern cannot be empty';

            if (isRegex) {
                try {
                    new RegExp(wmClass);
                } catch (e) {
                    return `Invalid regular expression: ${e.message}`;
                }
            }

            const defaults = getGlobalDefaults();
            const apps = getExcludedApps(defaults);
            if (apps.some(a => a.wm_class === wmClass && (a.match_mode || 'wm_class') === matchMode && !!a.is_regex === !!isRegex))
                return 'That app is already excluded';
            apps.push({ wm_class: wmClass, match_mode: matchMode, is_regex: isRegex });
            saveExcludedApps(defaults, apps);
            return null;
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

        // The same "Matching" block as the Applications tab and the per-rule
        // editor, so an exclusion is described exactly like the rule it mirrors
        // — window class or title, optionally as a regex.
        const excludeMatching = buildMatchingRows(excludeGroup);

        const excludeAddButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
            tooltip_text: 'Add this exclusion'
        });
        excludeMatching.patternRow.add_suffix(excludeAddButton);

        const onExcludeAddClicked = () => {
            const text = excludeMatching.patternEntry.get_text().trim();
            if (!text) return;

            const error = addExcluded(text, excludeMatching.regexSwitch.active, excludeMatching.getMode());
            if (error) {
                // Leave the form filled in so the pattern can be corrected.
                showToast(error);
                return;
            }
            excludeMatching.reset();
        };

        excludeAddButton.connect('clicked', onExcludeAddClicked);
        excludeMatching.patternEntry.connect('activate', onExcludeAddClicked);

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

            // Same "Restore" block as a per-app rule, so both surfaces read
            // identically — and identically to the window menu.
            const restoreSection = buildRestoreSection(defaults,
                (key, value) => updateGlobalDefaults(key, value));
            globalDefaultsGroup.add(restoreSection);
            globalDefaultsRows.push(restoreSection);

            getExcludedApps(defaults).forEach(rule => {
                let title = rule.wm_class;
                title += (rule.match_mode === 'title') ? ' (Title)' : ' (Class)';
                if (rule.is_regex) title += ' [Regex]';

                const excludedRow = new Adw.ActionRow({ title: title });
                const removeBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    css_classes: ['destructive-action'],
                    valign: Gtk.Align.CENTER
                });
                removeBtn.connect('clicked', () => removeExcluded(rule.wm_class, rule.match_mode, rule.is_regex));
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
            if (captureSignalId) {
                settings.disconnect(captureSignalId);
                captureSignalId = null;
            }
            cancelCaptureTimeout();
            Gtk.StyleContext.remove_provider_for_display(display, arrowFixProvider);
            rows = [];
            globalDefaultsRows = [];
            excludeRows = [];
        });
    }
}
