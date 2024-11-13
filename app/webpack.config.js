// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Heavily inspired (and slightly tweaked) from:
// https://github.com/jupyterlab/jupyterlab/blob/master/examples/federated/core_package/webpack.config.js

const fs = require('fs-extra');
const path = require('path');
const webpack = require('webpack');
const merge = require('webpack-merge').default;
const Handlebars = require('handlebars');
const { ModuleFederationPlugin } = webpack.container;
const BundleAnalyzerPlugin =
  require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const Build = require('@jupyterlab/builder').Build;
const WPPlugin = require('@jupyterlab/builder').WPPlugin;
const HtmlWebpackPlugin = require('html-webpack-plugin');
const baseConfig = require('@jupyterlab/builder/lib/webpack.config.base');

const topLevelData = require('./package.json');
const liteAppData = topLevelData.jupyterlite.apps.reduce(
  (memo, app) => ({ ...memo, [app]: require(`./${app}/package.json`) }),
  {}
);

// liteAppData is an object where each key is an app name and the vale are the contents of its package.json
// console.log('liteAppData', liteAppData);

// const names = Object.keys(topLevelData.dependencies).filter((name) => {
//   const packageData = require(path.join(name, 'package.json'));
//   return packageData.jupyterlab !== undefined;
// });

// Ensure a clear build directory.
const buildDir = path.resolve(__dirname, 'build');
if (fs.existsSync(buildDir)) {
  fs.removeSync(buildDir);
}
fs.ensureDirSync(buildDir);

Handlebars.registerHelper('json', (context) => {
  return JSON.stringify(context);
});

// custom help to check if a page corresponds to a value
Handlebars.registerHelper('ispage', (key, page) => {
  return key === page;
});

// custom helper to load the plugins on the index page
Handlebars.registerHelper('list_plugins', () => {
  let str = '';
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const page = this;
  Object.keys(this).forEach((extension) => {
    const plugin = page[extension];
    if (plugin === true) {
      str += `require('${extension}'),\n  `;
    } else if (Array.isArray(plugin)) {
      const plugins = plugin.map((p) => `'${p}',`).join('\n');
      str += `
      require('${extension}').default.filter(({id}) => [
       ${plugins}
      ].includes(id)),
      `;
    }
  });
  return str;
});

/**
 * Create the webpack ``shared`` configuration
 */
function createShared(packageData, shared = null) {
  // Set up module federation sharing config
  shared = shared || {};

  const extensionPackages = packageData.jupyterlab.extensions;

  // Make sure any resolutions are shared
  for (let [pkg, requiredVersion] of Object.entries(packageData.resolutions)) {
    shared[pkg] = { requiredVersion };
  }

  // Add any extension packages that are not in resolutions (i.e., installed from npm)
  for (let pkg of extensionPackages) {
    if (!shared[pkg]) {
      shared[pkg] = {
        requiredVersion: require(`${pkg}/package.json`).version,
      };
    }
  }

  // Add dependencies and sharedPackage config from extension packages if they
  // are not already in the shared config. This means that if there is a
  // conflict, the resolutions package version is the one that is shared.
  const extraShared = [];
  for (let pkg of extensionPackages) {
    let pkgShared = {};
    let {
      dependencies = {},
      jupyterlab: { sharedPackages = {} } = {},
    } = require(`${pkg}/package.json`);
    for (let [dep, requiredVersion] of Object.entries(dependencies)) {
      if (!shared[dep]) {
        pkgShared[dep] = { requiredVersion };
      }
    }

    // Overwrite automatic dependency sharing with custom sharing config
    for (let [dep, config] of Object.entries(sharedPackages)) {
      if (config === false) {
        delete pkgShared[dep];
      } else {
        if ('bundled' in config) {
          config.import = config.bundled;
          delete config.bundled;
        }
        pkgShared[dep] = config;
      }
    }
    extraShared.push(pkgShared);
  }

  // Now merge the extra shared config
  const mergedShare = {};
  for (let sharedConfig of extraShared) {
    for (let [pkg, config] of Object.entries(sharedConfig)) {
      // Do not override the basic share config from resolutions
      if (shared[pkg]) {
        continue;
      }

      // Add if we haven't seen the config before
      if (!mergedShare[pkg]) {
        mergedShare[pkg] = config;
        continue;
      }

      // Choose between the existing config and this new config. We do not try
      // to merge configs, which may yield a config no one wants
      let oldConfig = mergedShare[pkg];

      // if the old one has import: false, use the new one
      if (oldConfig.import === false) {
        mergedShare[pkg] = config;
      }
    }
  }

  Object.assign(shared, mergedShare);

  // Transform any file:// requiredVersion to the version number from the
  // imported package. This assumes (for simplicity) that the version we get
  // importing was installed from the file.
  for (let [pkg, { requiredVersion }] of Object.entries(shared)) {
    if (requiredVersion && requiredVersion.startsWith('file:')) {
      shared[pkg].requiredVersion = require(`${pkg}/package.json`).version;
    }
  }

  // Add singleton package information
  for (let pkg of packageData.jupyterlab.singletonPackages) {
    if (shared[pkg]) {
      shared[pkg].singleton = true;
    }
  }

  return shared;
}

// app/build
const topLevelBuild = path.resolve('build');

const allAssetConfig = [];
const allEntryPoints = {};
const allHtmlPlugins = [];

for (const [name, data] of Object.entries(liteAppData)) {
  const buildDir = path.join(name, 'build');

  const packageNames = data.jupyterlab.extensions;
  // Generate webpack config to copy extension assets to the build directory,
  // such as setting schema files, theme assets, etc.
  const extensionAssetConfig = Build.ensureAssets({
    packageNames,
    output: buildDir,
    schemaOutput: path.resolve(__dirname, '..', 'notebook'),
    // themeOutput: topLevelBuild,
  });

  allAssetConfig.push(extensionAssetConfig);

  // Create a list of application extensions and mime extensions from
  // jlab.extensions
  const extensions = {};
  const mimeExtensions = {};
  for (const key of packageNames) {
    const {
      jupyterlab: { extension, mimeExtension },
    } = require(`${key}/package.json`);
    if (extension !== undefined) {
      extensions[key] = extension === true ? '' : extension;
    }
    if (mimeExtension !== undefined) {
      mimeExtensions[key] = mimeExtension === true ? '' : mimeExtension;
    }
  }

  // Retrieve app info from package.json
  const { appClassName, appModuleName, disabledExtensions } = data.jupyterlab;

  // Create the entry point and other assets in build directory.
  const template = Handlebars.compile(
    fs.readFileSync(path.resolve('./index.template.js')).toString()
  );
  fs.writeFileSync(
    path.join(name, 'build', 'index.js'),
    template({
      name,
      appClassName,
      appModuleName,
      extensions,
      mimeExtensions,
      disabledExtensions,
    })
  );

  // Create the bootstrap file that loads federated extensions and calls the
  // initialization logic in index.js
  const entryPoint = `./${name}/build/bootstrap.js`;
  fs.copySync('bootstrap.js', entryPoint);
  // Copy the publicpath file
  const publicPath = `./${name}/build/publicpath.js`;
  fs.copySync('publicpath.js', publicPath);
  allEntryPoints[`${name}/bundle`] = entryPoint;
  allEntryPoints[`${name}/publicpath`] = publicPath;

  // Copy extra files
  const cssImports = path.resolve(__dirname, 'style.js');
  fs.copySync(cssImports, path.resolve(buildDir, 'extraStyle.js'));

  // Inject the name of the app in the template to be able to filter bundle files
  // const indexTemplate = Handlebars.compile(
  //   fs.readFileSync(path.resolve('./index.template.html')).toString()
  // );
  // fs.writeFileSync(
  //   path.join(name, 'build', 'index.template.html'),
  //   indexTemplate({
  //     name,
  //   })
  // );

  allHtmlPlugins.push(
    new HtmlWebpackPlugin({
      inject: false,
      minify: false,
      title: data.jupyterlab.title,
      filename: path.join(
        path.resolve(__dirname, '..', 'notebook/templates'),
        `${name}.html`
      ),
      template: path.join(path.resolve('./templates'), `${name}_template.html`),
    })
  );
}

// ! this was used to populate the template
// Handle the extensions.
// const { mimeExtensions, plugins } = topLevelData.jupyterlabz;

// ! this happens in createShared() now
// // Create the list of extension packages from the package.json metadata
// const extensionPackages = new Set();
// Object.keys(plugins).forEach((page) => {
//   const pagePlugins = plugins[page];
//   Object.keys(pagePlugins).forEach((name) => {
//     extensionPackages.add(name);
//   });
// });

// Create the entry point and other assets in build directory.
// const source = fs.readFileSync('index.template.js').toString();
// const extData = {
//   notebook_plugins: plugins,
//   notebook_mime_extensions: mimeExtensions,
// };
// const indexOut = template(extData);
// const template = Handlebars.compile(
//   fs.readFileSync('index.template.js').toString()
// );
// fs.writeFileSync(
//   path.join(buildDir, 'index.js'),
//   template({
//     notebook_plugins: plugins,
//     notebook_mime_extensions: mimeExtensions,
//   })
// );

// const extras = Build.ensureAssets({
//   packageNames: names,
//   output: buildDir,
//   schemaOutput: path.resolve(__dirname, '..', 'notebook'),
// });

// Make a bootstrap entrypoint
// const entryPoint = path.join(buildDir, 'bootstrap.js');
// const bootstrap = 'import("./index.js");';
// fs.writeFileSync(entryPoint, bootstrap);

// if (process.env.NODE_ENV === 'production') {
//   baseConfig.mode = 'production';
// }

// if (process.argv.includes('--analyze')) {
//   extras.push(new BundleAnalyzerPlugin());
// }

// const htmlPlugins = [];
// ['consoles', 'edit', 'error', 'notebooks', 'terminals', 'tree'].forEach(
//   (name) => {
//     htmlPlugins.push(
//       new HtmlWebpackPlugin({
//         chunksSortMode: 'none',
//         template: path.join(
//           path.resolve('./templates'),
//           `${name}_template.html`
//         ),
//         title: name,
//         filename: path.join(
//           path.resolve(__dirname, '..', 'notebook/templates'),
//           `${name}.html`
//         ),
//       })
//     );
//   }
// );

module.exports = [
  merge(baseConfig, {
    mode: 'development',
    devtool: 'source-map',
    entry: allEntryPoints,
    output: {
      path: path.resolve(__dirname, '..', 'notebook/static/'),
      // publicPath: '{{page_config.fullStaticUrl}}/',
      library: {
        type: 'var',
        name: ['_JUPYTERLAB', 'CORE_OUTPUT'],
      },
      filename: '[name].js?_=[contenthash:7]',
      chunkFilename: '[name].[contenthash:7].js',
      // to generate valid wheel names
      assetModuleFilename: '[name][ext][query]',
    },
    module: {
      rules: [
        {
          resourceQuery: /raw/,
          type: 'asset/source',
        },
        // just keep the woff2 fonts from fontawesome
        {
          test: /fontawesome-free.*\.(svg|eot|ttf|woff)$/,
          exclude: /fontawesome-free.*\.woff2$/,
        },
        {
          test: /\.(jpe?g|png|gif|ico|eot|ttf|map|woff2?)(\?v=\d+\.\d+\.\d+)?$/i,
          type: 'asset/resource',
        },
        {
          resourceQuery: /text/,
          type: 'asset/resource',
          generator: {
            filename: '[name][ext]',
          },
        },
      ],
    },
    optimization: {
      moduleIds: 'deterministic',
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          jlab_core: {
            test: /[\\/]node_modules[\\/]@(jupyterlab|jupyter-notebook|lumino(?!\/datagrid))[\\/]/,
            name: 'notebook_core',
          },
        },
      },
    },
    resolve: {
      fallback: { util: false },
    },
    plugins: [
      ...allHtmlPlugins,
      new WPPlugin.JSONLicenseWebpackPlugin({
        excludedPackageTest: (packageName) =>
          packageName === '@jupyter-notebook/app',
      }),
      new ModuleFederationPlugin({
        library: {
          type: 'var',
          name: ['_JUPYTERLAB', 'CORE_LIBRARY_FEDERATION'],
        },
        name: 'CORE_FEDERATION',
        shared: Object.values(liteAppData).reduce(
          (memo, data) => createShared(data, memo),
          {}
        ),
      }),
    ],
  }),
].concat(...allAssetConfig);

const logPath = path.join(buildDir, 'build_log.json');
fs.writeFileSync(logPath, JSON.stringify(module.exports, null, '  '));
