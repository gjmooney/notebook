// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Inspired by: https://github.com/jupyterlab/jupyterlab/blob/master/dev_mode/index.js
import { {{ appClassName }} } from '{{ appModuleName }}';

import { PageConfig } from '@jupyterlab/coreutils';

require('./style.js');
require('./extraStyle.js');

// custom list of disabled plugins
const disabled = [
    {{#each disabledExtensions}}
      "{{this}}",
    {{/each}}
    ];

async function createModule(scope, module) {
    try {
        const factory = await window._JUPYTERLAB[scope].get(module);
        const instance = factory();
        instance.__scope__ = scope;
        return instance;
    } catch (e) {
        console.warn(
        `Failed to create module: package: ${scope}; module: ${module}`
        );
        throw e;
    }
  }


/**
 * The main function
 */
export async function main() {

  const pluginsToRegister = [];

  const federatedExtensionPromises = [];
  const federatedMimeExtensionPromises = [];
  const federatedStylePromises = [];

  // This is all the data needed to load and activate plugins. This should be
  // gathered by the server and put onto the initial page template.
  const extensions = JSON.parse(
      PageConfig.getOption('federated_extensions')
      );

  const tttt = PageConfig.getOption('fullLabextensionsUrl')
  console.log('tttt', tttt)
  const federatedExtensionNames = new Set();

  extensions.forEach(data => {
    if (data.extension) {
      federatedExtensionNames.add(data.name);
      federatedExtensionPromises.push(createModule(data.name, data.extension));
    }
    if (data.mimeExtension) {
      federatedExtensionNames.add(data.name);
      federatedMimeExtensionPromises.push(createModule(data.name, data.mimeExtension));
    }
    if (data.style) {
      federatedStylePromises.push(createModule(data.name, data.style));
    }
  });

  /**
   * Iterate over active plugins in an extension.
   *
   * #### Notes
   * This also populates the disabled
   */
  function* activePlugins(extension) {
    // Handle commonjs or es2015 modules
    let exports;
    if (Object.prototype.hasOwnProperty.call(extension, '__esModule')) {
      exports = extension.default;
    } else {
      // CommonJS exports.
      exports = extension;
    }

    let plugins = Array.isArray(exports) ? exports : [exports];

    for (let plugin of plugins) {
        if (
          PageConfig.Extension.isDisabled(plugin.id) ||
          disabled.includes(plugin.id) ||
          disabled.includes(plugin.id.split(':')[0])
        ) {
          continue;
        }
      yield plugin;
    }
  }

  // Handle the mime extensions.
  const mimeExtensions = [];
  {{#each mimeExtensions}}
  if (!federatedExtensionNames.has('{{@key}}')) {
    try {
      let ext = require('{{@key}}{{#if this}}/{{this}}{{/if}}');
      for (let plugin of activePlugins(ext)) {
        mimeExtensions.push(plugin);
      }
    } catch (e) {
      console.error(e);
    }
  }
  {{/each}}

  // Add the federated mime extensions.
  const federatedMimeExtensions = await Promise.allSettled(federatedMimeExtensionPromises);
  federatedMimeExtensions.forEach(p => {
    if (p.status === "fulfilled") {
      for (let plugin of activePlugins(p.value)) {
        mimeExtensions.push(plugin);
      }
    } else {
      console.error(p.reason);
    }
  });

  // Handle the standard extensions.
  {{#each extensions}}
  if (!federatedExtensionNames.has('{{@key}}')) {
    try {
      let ext = require('{{@key}}{{#if this}}/{{this}}{{/if}}');
      for (let plugin of activePlugins(ext)) {
        pluginsToRegister.push(plugin);
      }
    } catch (e) {
      console.error(e);
    }
  }
  {{/each}}

  // Add the federated extensions.
  const federatedExtensions = await Promise.allSettled(federatedExtensionPromises);
  federatedExtensions.forEach(p => {
    if (p.status === "fulfilled") {
      for (let plugin of activePlugins(p.value)) {
        pluginsToRegister.push(plugin);
      }
    } else {
      console.error(p.reason);
    }
  });

  // Load all federated component styles and log errors for any that do not
  (await Promise.allSettled(federatedStylePromises))
    .filter(({ status }) => status === 'rejected')
    .forEach(({ reason }) => {
      console.error(reason);
    });

  // Set the list of base notebook multi-page plugins so the app is aware of all
  // its built-in plugins even if they are not loaded on the current page.
  // For example this is useful so the Settings Editor can list the debugger
  // plugin even if the debugger is only loaded on the notebook page.
//   PageConfig.setOption('allPlugins', '{{{ json notebook_plugins }}}');

  const NotebookApp = require('@jupyter-notebook/application').NotebookApp;
  // ! which arguments go here?
  const app = new NotebookApp({ mimeExtensions });
  app.name = PageConfig.getOption('appName') || 'JupyterLite';

  app.registerPluginModules(pluginsToRegister);

  // Expose global app instance when in dev mode or when toggled explicitly.
  const exposeAppInBrowser =
    (PageConfig.getOption('exposeAppInBrowser') || '').toLowerCase() === 'true';

  if (exposeAppInBrowser) {
    window.jupyterapp = app;
  }

  await app.start();
  await app.restored;
}
