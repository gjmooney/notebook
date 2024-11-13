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
        // instance.__scope__ = scope;
        return instance;
    } catch (e) {
        console.warn(
        `Failed to create module: package: ${scope}; module: ${module}`
        );
        throw e;
    }
    }

    // ! this (script and component) happens in config-utils on the html template or bootstrap.js??
// function loadScript(url) {
//   return new Promise((resolve, reject) => {
//     const newScript = document.createElement('script');
//     newScript.onerror = reject;
//     newScript.onload = resolve;
//     newScript.async = true;
//     document.head.appendChild(newScript);
//     newScript.src = url;
//   });
// }
// async function loadComponent(url, scope) {
//   await loadScript(url);

//   // From MIT-licensed https://github.com/module-federation/module-federation-examples/blob/af043acd6be1718ee195b2511adf6011fba4233c/advanced-api/dynamic-remotes/app1/src/App.js#L6-L12
//   // eslint-disable-next-line no-undef
//   await __webpack_init_sharing__('default');
//   const container = window._JUPYTERLAB[scope];
//   // Initialize the container, it may provide shared modules and may need ours
//   // eslint-disable-next-line no-undef
//   await container.init(__webpack_share_scopes__.default);
// }



/**
 * The main function
 */
async function main() {

  const pluginsToRegister = [];

    const federatedExtensionPromises = [];
    const federatedMimeExtensionPromises = [];
    const federatedStylePromises = [];

     // This is all the data needed to load and activate plugins. This should be
  // gathered by the server and put onto the initial page template.
    const extensions = JSON.parse(
        PageConfig.getOption('federated_extensions')
        );

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




  // Load the base plugins available on all pages


  // populate the list of disabled extensions
//   const disabled = [];
//   const availablePlugins = [];

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
    // for (let plugin of plugins) {
    //   const isDisabled = PageConfig.Extension.isDisabled(plugin.id);
    //   availablePlugins.push({
    //     id: plugin.id,
    //     description: plugin.description,
    //     requires: plugin.requires ?? [],
    //     optional: plugin.optional ?? [],
    //     provides: plugin.provides ?? null,
    //     autoStart: plugin.autoStart,
    //     enabled: !isDisabled,
    //     extension: extension.__scope__
    //   });
    //   if (isDisabled) {
    //     disabled.push(plugin.id);
    //     continue;
    //   }
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



//   const extensions = await Promise.allSettled(
//     extension_data.map(async data => {
//       await loadComponent(
//         `${URLExt.join(
//           PageConfig.getOption('fullLabextensionsUrl'),
//           data.name,
//           data.load
//         )}`,
//         data.name
//       );
//       return data;
//     })
//   );

//   extensions.forEach(p => {
//     if (p.status === 'rejected') {
//       // There was an error loading the component
//       console.error(p.reason);
//       return;
//     }

//     const data = p.value;
//     // if (data.extension) {
//     //   federatedExtensionPromises.push(createModule(data.name, data.extension));
//     // }
//     // if (data.mimeExtension) {
//     //   federatedMimeExtensionPromises.push(
//     //     createModule(data.name, data.mimeExtension)
//     //   );
//     // }
//     // if (data.style && !PageConfig.Extension.isDisabled(data.name)) {
//     //   federatedStylePromises.push(createModule(data.name, data.style));
//     // }
//   });

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
}

// window.addEventListener('load', main);
