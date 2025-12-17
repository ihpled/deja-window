import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
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
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Application Configuration',
            description: 'Add window classes (WM_CLASS) to manage.'
        });
        page.add(group);

        window.add(page);

        // -- Add New App Section --
        const addRow = new Adw.ActionRow({
            title: 'Add New Application',
            subtitle: 'Enter WM_CLASS (e.g. com.mitchellh.ghostty)'
        });
        group.add(addRow);

        // Create ComboBoxText with Entry
        const combo = Gtk.ComboBoxText.new_with_entry();
        const entry = combo.get_child();
        entry.set_placeholder_text('WM_CLASS');
        combo.set_hexpand(true);
        combo.set_valign(Gtk.Align.CENTER);

        // Populate with known classes
        const known = settings.get_value('known-wm-classes').recursiveUnpack();
        known.forEach(wmClass => {
            combo.append(wmClass, wmClass);
        });

        addRow.add_suffix(combo);

        // Regex Checkbox
        const regexCheck = new Gtk.CheckButton({
            label: 'Regex',
            valign: Gtk.Align.CENTER
        });
        addRow.add_suffix(regexCheck);

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        addRow.add_suffix(addButton);

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

        const updateConfig = (wmClass, key, value) => {
            const configs = getConfigs();
            const config = configs.find(c => c.wm_class === wmClass);
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

        const removeConfig = (wmClass) => {
            let configs = getConfigs();
            configs = configs.filter(c => c.wm_class !== wmClass);
            saveConfigs(configs);
        };

        const addConfig = (wmClass, isRegex = false) => {
            const configs = getConfigs();
            if (configs.find(c => c.wm_class === wmClass)) {
                return; // Already exists
            }
            configs.push({
                wm_class: wmClass,
                restore_size: false,
                restore_pos: false,
                restore_maximized: false,
                restore_workspace: false,
                switch_to_workspace: false,
                restore_minimized: false,
                restore_above: false,
                restore_sticky: false,
                is_regex: isRegex
            });
            saveConfigs(configs);
        };

        const onAddClicked = () => {
            const text = entry.get_text().trim();
            if (text) {
                addConfig(text, regexCheck.active);
                entry.set_text('');
                regexCheck.active = false;
            }
        };

        // Connect Add Button
        addButton.connect('clicked', onAddClicked);

        // -- List Section --
        const listGroup = new Adw.PreferencesGroup({
            title: 'Managed Applications'
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
                if (config.is_regex) {
                    title += ' (Regex)';
                }

                const isExpanded = expandedStates[title] || false;

                const row = new Adw.ExpanderRow({
                    title: title,
                    show_enable_switch: false, // We use a delete button instead
                    expanded: isExpanded
                });

                // Size Switch
                const sizeRow = new Adw.ActionRow({
                    title: 'Restore Size'
                });
                const sizeSwitch = new Gtk.Switch({
                    active: config.restore_size,
                    valign: Gtk.Align.CENTER
                });
                sizeSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'restore_size', sizeSwitch.active);
                });
                sizeRow.add_suffix(sizeSwitch);
                row.add_row(sizeRow);

                // Pos Switch
                const posRow = new Adw.ActionRow({
                    title: 'Restore Position'
                });
                const posSwitch = new Gtk.Switch({
                    active: config.restore_pos,
                    valign: Gtk.Align.CENTER
                });
                posSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'restore_pos', posSwitch.active);
                });
                posRow.add_suffix(posSwitch);
                row.add_row(posRow);

                // Maximized Switch
                const maxRow = new Adw.ActionRow({
                    title: 'Restore Maximized'
                });
                const maxSwitch = new Gtk.Switch({
                    active: config.restore_maximized || false,
                    valign: Gtk.Align.CENTER
                });
                maxSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'restore_maximized', maxSwitch.active);
                });
                maxRow.add_suffix(maxSwitch);
                row.add_row(maxRow);

                // Workspace Switch
                const workspaceRow = new Adw.ActionRow({
                    title: 'Restore Workspace'
                });
                const workspaceSwitch = new Gtk.Switch({
                    active: config.restore_workspace || false,
                    valign: Gtk.Align.CENTER
                });
                workspaceSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'restore_workspace', workspaceSwitch.active);
                });
                workspaceRow.add_suffix(workspaceSwitch);
                row.add_row(workspaceRow);

                // Switch to Workspace Switch
                const switchWorkspaceRow = new Adw.ActionRow({
                    title: 'Switch to Workspace',
                    subtitle: 'Activate the workspace where the window is restored'
                });
                const switchWorkspaceSwitch = new Gtk.Switch({
                    active: config.switch_to_workspace || false,
                    valign: Gtk.Align.CENTER
                });
                switchWorkspaceSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'switch_to_workspace', switchWorkspaceSwitch.active);
                });
                switchWorkspaceRow.add_suffix(switchWorkspaceSwitch);
                row.add_row(switchWorkspaceRow);

                // Minimized Switch
                const minimizedRow = new Adw.ActionRow({
                    title: 'Restore Minimized'
                });
                const minimizedSwitch = new Gtk.Switch({
                    active: config.restore_minimized || false,
                    valign: Gtk.Align.CENTER
                });
                minimizedSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'restore_minimized', minimizedSwitch.active);
                });
                minimizedRow.add_suffix(minimizedSwitch);
                row.add_row(minimizedRow);

                // Always on Top Switch
                const aboveRow = new Adw.ActionRow({
                    title: 'Restore Always on Top'
                });
                const aboveSwitch = new Gtk.Switch({
                    active: config.restore_above || false,
                    valign: Gtk.Align.CENTER
                });
                aboveSwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'restore_above', aboveSwitch.active);
                });
                aboveRow.add_suffix(aboveSwitch);
                row.add_row(aboveRow);

                // Sticky Switch
                const stickyRow = new Adw.ActionRow({
                    title: 'Restore Always on Visible Workspace'
                });
                const stickySwitch = new Gtk.Switch({
                    active: config.restore_sticky || false,
                    valign: Gtk.Align.CENTER
                });
                stickySwitch.connect('notify::active', () => {
                    updateConfig(config.wm_class, 'restore_sticky', stickySwitch.active);
                });
                stickyRow.add_suffix(stickySwitch);
                row.add_row(stickyRow);

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
                    removeConfig(config.wm_class);
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

        // Cleanup on window close
        window.connect('close-request', () => {
            if (settingsSignalId) {
                settings.disconnect(settingsSignalId);
                settingsSignalId = null;
            }
            rows = [];
        });
    }
}