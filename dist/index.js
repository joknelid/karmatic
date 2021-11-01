function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var karma = require('karma');
var path = _interopDefault(require('path'));
var puppeteer = _interopDefault(require('puppeteer'));
var chalk = _interopDefault(require('chalk'));
var fs = _interopDefault(require('fs'));
var simpleCodeFrame = require('simple-code-frame');
var errorstacks = require('errorstacks');
var delve = _interopDefault(require('dlv'));

const cwd = process.cwd();
const res = file => path.resolve(cwd, file);
function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {}

  return false;
}
function readFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {}
}
function readDir(file) {
  try {
    return fs.readdirSync(file);
  } catch (e) {}
}
function tryRequire(file) {
  if (fileExists(file)) return require(file);
}
function dedupe(value, index, arr) {
  return arr.indexOf(value) === index;
}
function indent(str, level) {
  const space = ' '.repeat(level);
  return str.split('\n').map(line => space + line).join('\n');
}
/**
 * Colorize a pre-formatted code frame
 * @param {string} str
 */

function highlightCodeFrame(str) {
  return str.split('\n').map(line => {
    if (/^>\s(.*)/.test(line)) {
      return line.replace(/^>(.*)/, (_, content) => {
        return chalk.bold.redBright('>') + chalk.white(content);
      });
    } else if (/^\s+\|\s+\^/.test(line)) {
      return line.replace('|', chalk.dim('|')).replace('^', chalk.bold.redBright('^'));
    }

    return chalk.dim(line);
  }).join('\n');
}
function cleanStack(str, cwd = process.cwd()) {
  str = str.replace(/^[\s\S]+\n\n([A-Za-z]*Error: )/g, '$1');
  let stack = str.replace(new RegExp(`( |\\()(https?:\\/\\/localhost:\\d+\\/base\\/|webpack:///|${cwd.replace(/([\\/[\]()*+$!^.,?])/g, '\\$1')}\\/*)?([^\\s():?]*?)(?:\\?[a-zA-Z0-9]+?)?(:\\d+(?::\\d+)?)`, 'g'), replacer);
  let frames = errorstacks.parseStackTrace(stack); // Some frameworks mess with the stack. Use a simple heuristic
  // to find the beginning of the proper stack.

  let message = stack;

  if (frames.length) {
    let lines = stack.split('\n');
    let stackStart = lines.indexOf(frames[0].raw);

    if (stackStart > 0) {
      message = lines.slice(0, stackStart).map(s => s.trim()).join('\n');
    }
  }
  /**
   * The nearest location where the user's code triggered the error.
   * @type {import('errorstacks').StackFrame}
   */


  let nearestFrame;
  stack = frames.filter(frame => frame.type !== 'native' || frame.name !== 'Jasmine').map(frame => {
    // Only show frame for errors in the user's code
    if (!nearestFrame && !/node_modules/.test(frame.fileName) && frame.type !== 'native') {
      nearestFrame = frame;
    } // Native traces don't have an error location


    if (!frame.name || frame.type === 'native') {
      return chalk.gray(frame.raw.trim());
    }

    const {
      sourceFileName,
      column,
      fileName,
      line,
      name,
      sourceColumn,
      sourceLine
    } = frame;
    const loc = chalk.cyanBright(`${fileName}:${line}:${column}`);
    const originalLoc = sourceFileName !== '' ? chalk.gray(' <- ') + chalk.gray(`${sourceFileName}:${sourceLine}:${sourceColumn}`) : '';
    return chalk.gray(`at ${name} (${loc}${originalLoc})`);
  }).join('\n');
  let codeFrame = '';

  if (nearestFrame) {
    try {
      const {
        fileName,
        line,
        column
      } = nearestFrame;

      if (fileName) {
        const content = fs.readFileSync(fileName, 'utf-8');
        codeFrame = simpleCodeFrame.createCodeFrame(content, line - 1, column - 1, {
          before: 2,
          after: 2
        });
        codeFrame = highlightCodeFrame(codeFrame);
        codeFrame = indent(codeFrame, 2) + '\n';
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('INTERNAL WARNING: Failed to read stack frame code: ' + err);
    }
  }

  message = indent(chalk.reset(message), 2);
  return `\n${message}\n\n${codeFrame}${indent(stack, 4)}\n`;
}

function replacer(str, before, root, filename, position) {
  return before + './' + filename + position;
}

/**
 * @param {import('../configure').Options} options
 */
function babelConfig(options) {
  return {
    presets: [[require.resolve('@babel/preset-env'), {
      targets: {
        browsers: ['last 2 Chrome versions', 'last 2 Firefox versions', (options.downlevel || options.browsers && String(options.browsers).match(/(\b|ms|microsoft)(ie|internet.explorer|edge)/gi)) && 'ie>=9'].filter(Boolean)
      },
      corejs: 3,
      useBuiltIns: 'usage',
      modules: false,
      loose: true
    }]],
    plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), {
      pragma: options.pragma || 'h'
    }]].concat(options.coverage ? [require.resolve('babel-plugin-istanbul')] : [])
  };
}
/**
 * @param {import('../configure').Options} options
 */

function babelLoader(options) {
  return {
    test: /\.jsx?$/,
    exclude: /node_modules/,
    loader: require.resolve('babel-loader'),
    query: babelConfig(options)
  };
}

function cssLoader(options) {
  return {
    test: /\.css$/,
    loader: 'style-loader!css-loader'
  };
}

/**
 * @param {import('./configure').Options} options
 * @returns {boolean}
 */

function shouldUseWebpack(options) {
  let shouldUse = true;

  try {
    require('webpack');
  } catch (error) {
    shouldUse = false;
  }

  return shouldUse;
}
/**
 * @param {Object} karmaConfig
 * @param {Object} pkg
 * @param {import('./configure').Options} options
 */

function addWebpackConfig(karmaConfig, pkg, options) {
  const WEBPACK_VERSION = String(require('webpack').version || '3.0.0');
  const WEBPACK_MAJOR = parseInt(WEBPACK_VERSION.split('.')[0], 10);
  const WEBPACK_CONFIGS = ['webpack.config.babel.js', 'webpack.config.js'];
  let webpackConfig = options.webpackConfig;

  if (pkg.scripts) {
    for (let i in pkg.scripts) {
      let script = pkg.scripts[i];

      if (/\bwebpack\b[^&|]*(-c|--config)\b/.test(script)) {
        let matches = script.match(/(?:-c|--config)\s+(?:([^\s])|(["'])(.*?)\2)/);
        let configFile = matches && (matches[1] || matches[2]);
        if (configFile) WEBPACK_CONFIGS.push(configFile);
      }
    }
  }

  if (!webpackConfig) {
    for (let i = WEBPACK_CONFIGS.length; i--;) {
      webpackConfig = tryRequire(res(WEBPACK_CONFIGS[i]));
      if (webpackConfig) break;
    }
  }

  if (typeof webpackConfig === 'function') {
    webpackConfig = webpackConfig({
      karmatic: true
    }, {
      mode: 'development',
      karmatic: true
    });
  }

  webpackConfig = webpackConfig || {};
  let loaders = [].concat(delve(webpackConfig, 'module.loaders') || [], delve(webpackConfig, 'module.rules') || []);

  function evaluateCondition(condition, filename, expected) {
    if (typeof condition === 'function') {
      return condition(filename) == expected;
    } else if (condition instanceof RegExp) {
      return condition.test(filename) == expected;
    }

    if (Array.isArray(condition)) {
      for (let i = 0; i < condition.length; i++) {
        if (evaluateCondition(condition[i], filename)) return expected;
      }
    }

    return !expected;
  }

  function getLoader(predicate) {
    if (typeof predicate === 'string') {
      let filename = predicate;

      predicate = loader => {
        let {
          test,
          include,
          exclude
        } = loader;
        if (exclude && evaluateCondition(exclude, filename, false)) return false;
        if (include && !evaluateCondition(include, filename, true)) return false;
        if (test && evaluateCondition(test, filename, true)) return true;
        return false;
      };
    }

    for (let i = 0; i < loaders.length; i++) {
      if (predicate(loaders[i])) {
        return {
          index: i,
          loader: loaders[i]
        };
      }
    }

    return false;
  }

  function webpackProp(name, value) {
    let configured = delve(webpackConfig, name);

    if (Array.isArray(value)) {
      return value.concat(configured || []).filter(dedupe);
    }

    return Object.assign({}, configured || {}, value);
  }

  for (let prop of Object.keys(karmaConfig.preprocessors)) {
    karmaConfig.preprocessors[prop].unshift('webpack');
  }

  karmaConfig.plugins.push(require.resolve('karma-webpack'));
  karmaConfig.webpack = {
    devtool: 'inline-source-map',
    // devtool: 'module-source-map',
    mode: webpackConfig.mode || 'development',
    module: {
      // @TODO check webpack version and use loaders VS rules as the key here appropriately:
      //
      // TODO: Consider adding coverage as a separate babel-loader so that
      // regardless if the user provides their own babel plugins, coverage still
      // works
      rules: loaders.concat(!getLoader(rule => `${rule.use},${rule.loader}`.match(/\bbabel-loader\b/)) ? babelLoader(options) : false, !getLoader('foo.css') && cssLoader()).filter(Boolean)
    },
    resolve: webpackProp('resolve', {
      modules: webpackProp('resolve.modules', ['node_modules', path.resolve(__dirname, '../node_modules')]),
      alias: webpackProp('resolve.alias', {
        [pkg.name]: res('.'),
        src: res('src')
      })
    }),
    resolveLoader: webpackProp('resolveLoader', {
      modules: webpackProp('resolveLoader.modules', ['node_modules', path.resolve(__dirname, '../node_modules')]),
      alias: webpackProp('resolveLoader.alias', {
        [pkg.name]: res('.'),
        src: res('src')
      })
    }),
    plugins: (webpackConfig.plugins || []).filter(plugin => {
      let name = plugin && plugin.constructor.name;
      return /^\s*(UglifyJS|HTML|ExtractText|BabelMinify)(.*Webpack)?Plugin\s*$/gi.test(name);
    }),
    node: webpackProp('node', {}),
    performance: {
      hints: false
    }
  };
  karmaConfig.webpackMiddleware = {
    noInfo: true,
    logLevel: 'error',
    stats: 'errors-only'
  };

  if (WEBPACK_MAJOR < 4) {
    delete karmaConfig.webpack.mode;
    let {
      rules
    } = karmaConfig.webpack.module;
    delete karmaConfig.webpack.module.rules;
    karmaConfig.webpack.module.loaders = rules;
  }

  return karmaConfig;
}

function _extends() {
  _extends = Object.assign || function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];

      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }

    return target;
  };

  return _extends.apply(this, arguments);
}

/**
 * @param {import('./configure').Options} options
 */

function getDefaultConfig(options) {
  let babel = require('@rollup/plugin-babel').default;

  let commonjs = require('@rollup/plugin-commonjs');

  let nodeResolve = require('@rollup/plugin-node-resolve').default;

  return {
    output: {
      format: 'iife',
      name: `KarmaticTests`,
      sourcemap: 'inline'
    },
    plugins: [babel(_extends({
      babelHelpers: 'bundled'
    }, babelConfig(options))), nodeResolve(), commonjs()]
  };
}
/**
 * @param {Object} pkg
 * @param {import('./configure').Options} options
 */


async function getRollupConfig(pkg, options) {
  const ROLLUP_CONFIGS = ['rollup.config.mjs', 'rollup.config.cjs', 'rollup.config.js'];
  let rollupConfig = options.rollupConfig;

  if (pkg.scripts) {
    for (let i in pkg.scripts) {
      let script = pkg.scripts[i];

      if (/\brollup\b[^&|]*(-c|--config)\b/.test(script)) {
        let matches = script.match(/(?:-c|--config)\s+(?:([^\s])|(["'])(.*?)\2)/);
        let configFile = matches && (matches[1] || matches[2]);
        if (configFile) ROLLUP_CONFIGS.push(configFile);
      }
    }
  }

  if (!rollupConfig) {
    for (let i = ROLLUP_CONFIGS.length; i--;) {
      let possiblePath = res(ROLLUP_CONFIGS[i]);

      if (fileExists(possiblePath)) {
        // Require Rollup 2.3.0 for this export: https://github.com/rollup/rollup/blob/master/CHANGELOG.md#230
        let loadConfigFile = require('rollup/dist/loadConfigFile');

        let rollupConfigResult = await loadConfigFile(possiblePath);
        rollupConfigResult.warnings.flush();

        if (rollupConfigResult.options.length > 1) {
          console.error('Rollup config returns an array configs. Using the first one for tests');
        }

        rollupConfig = rollupConfigResult.options[0];
        break;
      }
    }
  }

  if (rollupConfig) {
    let babel = require('@rollup/plugin-babel').default;

    rollupConfig.plugins = (rollupConfig.plugins || []).concat([babel({
      babelHelpers: 'bundled',
      plugins: [require.resolve('babel-plugin-istanbul')]
    })]);
    return rollupConfig;
  }

  return getDefaultConfig(options);
}
/**
 * @param {Object} karmaConfig
 * @param {Object} pkg
 * @param {import('./configure').Options} options
 */


async function addRollupConfig(karmaConfig, pkg, options) {
  // From karma-rollup-preprocessor readme:
  // Make sure to disable Karma’s file watcher
  // because the preprocessor will use its own.
  for (let i = 0; i < karmaConfig.files; i++) {
    let entry = karmaConfig.files[i];

    if (typeof entry == 'string') {
      karmaConfig.files[i] = {
        pattern: entry,
        watched: false
      };
    } else {
      karmaConfig.files[i].watched = false;
    }
  }

  for (let prop of Object.keys(karmaConfig.preprocessors)) {
    karmaConfig.preprocessors[prop].unshift('rollup');
  }

  karmaConfig.plugins.push(require.resolve('karma-rollup-preprocessor'));
  karmaConfig.rollupPreprocessor = await getRollupConfig(pkg, options);
}

/**
 * @typedef Options
 * @property {Array} files - Test files to run
 * @property {Array} [browsers] - Custom list of browsers to run in
 * @property {Boolean} [headless=false] - Run in Headless Chrome?
 * @property {Boolean} [watch=false] - Start a continuous test server and retest when files change
 * @property {Boolean} [coverage=false] - Instrument and collect code coverage statistics
 * @property {Object} [webpackConfig] - Custom webpack configuration
 * @property {Object} [rollupConfig] - Custom rollup configuration
 * @property {string} [pragma] - JSX pragma to compile JSX with
 * @property {Boolean} [downlevel=false] - Downlevel/transpile syntax to ES5
 * @property {string} [chromeDataDir] - Use a custom Chrome profile directory
 *
 * @param {Options} options
 */

async function configure(options) {
  let cwd = process.cwd(),
      res = file => path.resolve(cwd, file);

  let files = options.files.filter(Boolean);
  if (!files.length) files = ['**/{*.test.js,*_test.js}'];
  process.env.CHROME_BIN = puppeteer.executablePath();
  let gitignore = (readFile(path.resolve(cwd, '.gitignore')) || '').replace(/(^\s*|\s*$|#.*$)/g, '').split('\n').filter(Boolean);
  let repoRoot = (readDir(cwd) || []).filter(c => c[0] !== '.' && c !== 'node_modules' && gitignore.indexOf(c) === -1);
  let rootFiles = '{' + repoRoot.join(',') + '}';
  const PLUGINS = ['karma-chrome-launcher', 'karma-jasmine', 'karma-spec-reporter', 'karma-min-reporter', 'karma-sourcemap-loader'].concat(options.coverage ? 'karma-coverage' : []);
  const preprocessors = ['sourcemap']; // Custom launchers to be injected:

  const launchers = {};
  let useSauceLabs = false;
  let browsers;

  if (options.browsers) {
    browsers = options.browsers.map(browser => {
      if (/^chrome([ :-]?headless)?$/i.test(browser)) {
        return `KarmaticChrome${/headless/i.test(browser) ? 'Headless' : ''}`;
      }

      if (/^firefox$/i.test(browser)) {
        PLUGINS.push('karma-firefox-launcher');
        return 'Firefox';
      }

      if (/^sauce-/.test(browser)) {
        if (!useSauceLabs) {
          useSauceLabs = true;
          PLUGINS.push('karma-sauce-launcher');
        }

        const parts = browser.toLowerCase().split('-');
        const name = parts.join('_');
        launchers[name] = {
          base: 'SauceLabs',
          browserName: parts[1].replace(/^(msie|ie|internet ?explorer)$/i, 'Internet Explorer').replace(/^(ms|microsoft|)edge$/i, 'MicrosoftEdge'),
          version: parts[2] || undefined,
          platform: parts[3] ? parts[3].replace(/^win(dows)?[ -]+/gi, 'Windows ').replace(/^(macos|mac ?os ?x|os ?x)[ -]+/gi, 'OS X ') : undefined
        };
        return name;
      }

      return browser;
    });
  } else {
    browsers = [options.headless === false ? 'KarmaticChrome' : 'KarmaticChromeHeadless'];
  }

  if (useSauceLabs) {
    let missing = ['SAUCE_USERNAME', 'SAUCE_ACCESS_KEY'].filter(x => !process.env[x])[0];

    if (missing) {
      throw '\n' + chalk.bold.bgRed.white('Error:') + ' Missing SauceLabs auth configuration.' + '\n  ' + chalk.white(`A SauceLabs browser was requested, but no ${chalk.magentaBright(missing)} environment variable provided.`) + '\n  ' + chalk.white('Try prepending it to your test command:') + '  ' + chalk.greenBright(missing + '=... npm test') + '\n';
    }
  }

  let pkg = tryRequire(res('package.json'));
  const chromeDataDir = options.chromeDataDir ? path.resolve(cwd, options.chromeDataDir) : null;
  const flags = ['--no-sandbox'];
  let generatedConfig = {
    basePath: cwd,
    plugins: PLUGINS.map(req => require.resolve(req)),
    frameworks: ['jasmine'],
    browserNoActivityTimeout: options.inactivityTimeout,
    reporters: [options.watch ? 'min' : 'spec'].concat(options.coverage ? 'coverage' : [], useSauceLabs ? 'saucelabs' : []),
    browsers,
    sauceLabs: {
      testName: pkg && pkg.name || undefined
    },
    customLaunchers: Object.assign({
      KarmaticChrome: {
        base: 'Chrome',
        chromeDataDir,
        flags
      },
      KarmaticChromeHeadless: {
        base: 'ChromeHeadless',
        chromeDataDir,
        flags
      }
    }, launchers),
    coverageReporter: {
      reporters: [{
        type: 'text-summary'
      }, {
        type: 'html'
      }, {
        type: 'lcovonly',
        subdir: '.',
        file: 'lcov.info'
      }]
    },

    formatError(msg) {
      try {
        msg = JSON.parse(msg).message;
      } catch (e) {}

      return cleanStack(msg);
    },

    logLevel: 'ERROR',
    loggers: [{
      type: path.resolve(__dirname, 'appender.js')
    }],
    files: [// Inject Jest matchers:
    {
      pattern: path.resolve(__dirname, '../node_modules/expect/build-es5/index.js'),
      watched: false,
      included: true,
      served: true
    }].concat(...files.map(pattern => {
      // Expand '**/xx' patterns but exempt node_modules and gitignored directories
      let matches = pattern.match(/^\*\*\/(.+)$/);
      if (!matches) return {
        pattern,
        watched: true,
        served: true,
        included: true
      };
      return [{
        pattern: rootFiles + '/' + matches[0],
        watched: true,
        served: true,
        included: true
      }, {
        pattern: matches[1],
        watched: true,
        served: true,
        included: true
      }];
    })),
    preprocessors: {
      [rootFiles + '/**/*']: preprocessors,
      [rootFiles]: preprocessors
    },
    colors: true,
    client: {
      captureConsole: true,
      jasmine: {
        random: false
      }
    }
  };

  if (shouldUseWebpack()) {
    addWebpackConfig(generatedConfig, pkg, options);
  } else {
    await addRollupConfig(generatedConfig, pkg, options);
  }

  return generatedConfig;
}

async function karmatic(options) {
  let config = await configure(options);
  if (!options.watch) config.singleRun = true;
  let server = createServer(config);
  server.start();
  return await server.completion;
}

function createServer(config) {
  let resolve, reject;
  let promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  let callback = code => {
    if (code === 0) return resolve();
    let err = Error(`Exit ${code}`);
    err.code = code;
    reject(err);
  };

  let server = new karma.Server(config, callback);
  server.completion = promise;
  return server;
}

module.exports = karmatic;
//# sourceMappingURL=index.js.map
