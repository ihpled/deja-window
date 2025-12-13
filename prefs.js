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
     * Builds and returns the preferences widget for the extension settings page.
     * @returns {Adw.PreferencesPage} The preferences page.
     */
    getPreferencesWidget() {
        this._settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Application Configuration',
            description: 'Add window classes (WM_CLASS) to manage.'
        });
        page.add(group);

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
        const known = this._settings.get_value('known-wm-classes').recursiveUnpack();
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

        addButton.connect('clicked', () => {
            this._onAddClicked(combo, regexCheck);
        });
        // -- List Section --
        const listGroup = new Adw.PreferencesGroup({
            title: 'Managed Applications'
        });
        page.add(listGroup);

        // Track rows to remove them later
        this._rows = [];

        this._refreshList(listGroup);

        // Listen for external changes (e.g. manual dconf edits)
        // Listen for external changes (e.g. manual dconf edits)
        this._settingsSignalId = this._settings.connect('changed::window-app-configs', () => {
            this._refreshList(listGroup);
        });

        return page;
    }


    /**
     * Handles the click event for the "Add New Application" button.
     * Reads values from inputs and adds a new configuration entry.
     * @param {Gtk.ComboBoxText} combo - The combo box containing the WM_CLASS entry.
     * @param {Gtk.CheckButton} regexCheck - The checkbox for regex mode.
     */
    _onAddClicked(combo, regexCheck) {
        const entry = combo.get_child();
        const wmClass = entry.get_text().trim();
        if (wmClass) {
            this._addConfig(wmClass, regexCheck.active);
            entry.set_text('');
            regexCheck.active = false;
        }
    }



    /**
     * Retrieves the current list of window configurations from GSettings.
     * @returns {Array} List of config objects.
     */
    _getConfigs() {
        const json = this._settings.get_string('window-app-configs');
        try {
            return JSON.parse(json) || [];
        } catch (e) {
            console.error('Error parsing window-app-configs:', e);
            return [];
        }
    }

    /**
     * Saves the list of window configurations to GSettings.
     * @param {Array} configs - List of config objects to save.
     */
    _saveConfigs(configs) {
        this._settings.set_string('window-app-configs', JSON.stringify(configs));
    }

    /**
     * Adds a new window configuration.
     * @param {string} wmClass - The class name or regex pattern of the window.
     * @param {boolean} isRegex - Whether the class name should be treated as a regex.
     */
    _addConfig(wmClass, isRegex = false) {
        const configs = this._getConfigs();
        if (configs.find(c => c.wm_class === wmClass)) {
            return; // Already exists
        }
        configs.push({
            wm_class: wmClass,
            restore_size: false,
            restore_pos: false,
            restore_maximized: false,
            is_regex: isRegex
        });
        this._saveConfigs(configs);
    }

    /**
     * Removes a window configuration by its WM_CLASS/Pattern.
     * @param {string} wmClass - The wm_class identifier to remove.
     */
    _removeConfig(wmClass) {
        let configs = this._getConfigs();
        configs = configs.filter(c => c.wm_class !== wmClass);
        this._saveConfigs(configs);
    }

    /**
     * Updates a specific property of a window configuration.
     * @param {string} wmClass - The identifier of the config to update.
     * @param {string} key - The property key to update (e.g., 'restore_size').
     * @param {any} value - The new value for the property.
     */
    _updateConfig(wmClass, key, value) {
        const configs = this._getConfigs();
        const config = configs.find(c => c.wm_class === wmClass);
        if (config) {
            config[key] = value;

            // Block signal to prevent list rebuild (which collapses rows)
            if (this._settingsSignalId) {
                this._settings.block_signal_handler(this._settingsSignalId);
            }

            this._saveConfigs(configs);

            if (this._settingsSignalId) {
                this._settings.unblock_signal_handler(this._settingsSignalId);
            }
        }
    }

    /**
     * Refreshes the list of managed applications in the UI.
     * Rebuilds the list rows based on the current configuration.
     * @param {Adw.PreferencesGroup} group - The Adwaita group to populate.
     */
    _refreshList(group) {
        // Capture expansion state
        const expandedStates = {};
        if (this._rows) {
            this._rows.forEach(row => {
                // The title is the wm_class
                expandedStates[row.get_title()] = row.get_expanded();
                group.remove(row);
            });
        }
        this._rows = [];

        const configs = this._getConfigs();

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
                this._updateConfig(config.wm_class, 'restore_size', sizeSwitch.active);
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
                this._updateConfig(config.wm_class, 'restore_pos', posSwitch.active);
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
                this._updateConfig(config.wm_class, 'restore_maximized', maxSwitch.active);
            });
            maxRow.add_suffix(maxSwitch);
            row.add_row(maxRow);

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
                this._removeConfig(config.wm_class);
            });
            deleteRow.add_suffix(deleteBtn);
            row.add_row(deleteRow);

            group.add(row);
            this._rows.push(row);
        });
    }
}