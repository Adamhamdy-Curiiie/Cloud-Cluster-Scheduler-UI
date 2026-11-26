const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const config = require('../java-config');

function compileJava(classesPath, compiler) {
  fs.mkdirSync(classesPath, { recursive: true });
  const sources = fs.readdirSync(config.workingDirectory)
    .filter(name => name.endsWith('.java'))
    .map(name => path.join(config.workingDirectory, name));
  const result = spawnSync(compiler, ['-encoding', 'UTF-8', '-d', classesPath, ...sources],
    { cwd: config.workingDirectory, stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`Cannot start javac at "${compiler}": ${result.error.message}`);
  if (result.status !== 0) throw new Error(`javac exited with ${result.status ?? result.signal}.`);
}

if (require.main === module) {
  try {
    compileJava(config.classesPath, config.compiler);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { compileJava };
