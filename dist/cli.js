#!/usr/bin/env node
function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var sade = _interopDefault(require('sade'));
var chalk = _interopDefault(require('chalk'));
var karmatic = _interopDefault(require('./index.js'));
var fs = _interopDefault(require('fs'));
require('path');
var simpleCodeFrame = require('simple-code-frame');
var errorstacks = require('errorstacks');

let {
  write
} = process.stdout;

process.stdout.write = msg => {
  // Strip + prettify console forwarded output:
  let matches = msg.match(/^LOG\s*([A-Z]+): ([\s\S]*)$/); // "min" reporter has slightly different output

  if (!matches) {
    matches = msg.match(/^(LOG): ([\s\S]*)$/);
  }

  if (matches) {
    msg = chalk.bgBlueBright.white(' ' + matches[1] + ': ') + ' ' + chalk.blue(matches[2]);
  } // Strip browser prefix from the output since there's only one:


  if (msg.match(/^[\n\s]*HeadlessChrome/)) {
    let color = /\bSUCCESS\b/.test(msg) ? 'greenBright' : 'magenta';
    msg = chalk[color](msg.replace(/^[\n\s]*.*?: /g, ''));
  } // Ignore total output since we only have one browser:
  // eslint-disable-next-line no-control-regex


  if (msg.match(/\u001b\[32mTOTAL: /)) return;
  return write.call(process.stdout, msg);
};

const cwd = process.cwd();
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

const {
  version
} = require('../package.json');

let toArray = val => typeof val === 'string' ? val.split(/\s*,\s*/) : val == null ? [] : [].concat(val);

let prog = sade('karmatic');
prog.version(version).option('--files', 'Minimatch pattern for test files').option('--headless', 'Run using Chrome Headless', true).option('--coverage', 'Report code coverage of tests', true).option('--downlevel', 'Downlevel syntax to ES5').option('--chromeDataDir', 'Save Chrome preferences');
prog.command('run [...files]', '', {
  default: true
}).describe('Run tests once and exit').option('--watch', 'Enable watch mode (alias: karmatic watch)', false).action(run);
prog.command('watch [...files]').describe('Run tests on any change').action((str, opts) => run(str, opts, true));
prog.command('debug [...files]').describe('Open a headful Puppeteer instance for debugging your tests').option('--headless', 'Run using Chrome Headless', false) // Override default to false
.option('--browsers', 'Run in specific browsers', null).option('--coverage', 'Report code coverage of tests', false) // Override default to false
.action((str, opts) => run(str, opts, true));
prog.parse(process.argv);

function run(str, opts, isWatch) {
  opts.watch = opts.watch === true || isWatch === true;
  opts.files = toArray(str || opts.files).concat(opts._);
  const b = opts.browsers || opts.browser;
  opts.browsers = b ? toArray(b) : null;
  karmatic(opts).then(output => {
    if (output != null) process.stdout.write(output + '\n');
    if (!opts.watch) process.exit(0);
  }).catch(err => {
    if (!(typeof err.code === 'number' && err.code >= 0 && err.code < 10)) {
      process.stderr.write(chalk.red(cleanStack(err && (err.stack || err.message) || err)) + '\n');
    }

    process.exit(typeof err.code == 'number' ? err.code : 1);
  });
}
//# sourceMappingURL=cli.js.map
