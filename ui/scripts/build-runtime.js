const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compileJava } = require('./build-java');

function buildRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Build the Windows x64 runtime with Windows x64 Node.js.');
  }
  if (!process.env.JAVA_HOME) throw new Error('Set JAVA_HOME to a Windows x64 JDK (see README.md).');
  const jdk = path.resolve(process.env.JAVA_HOME);
  const release = fs.readFileSync(path.join(jdk, 'release'), 'utf8');
  if (!/^OS_ARCH="(?:amd64|x86_64)"\s*$/m.test(release) || !/^OS_NAME="Windows"\s*$/m.test(release)) {
    throw new Error('JAVA_HOME must point to a Windows x64 JDK.');
  }
  const tool = name => path.join(jdk, 'bin', name + '.exe');
  const build = path.resolve(__dirname, '../../bin/ui');
  fs.mkdirSync(build, { recursive: true });
  const stage = fs.mkdtempSync(path.join(build, 'jlink-'));
  const resources = path.join(stage, 'scheduler');
  const classes = path.join(stage, 'classes');
  const jar = path.join(resources, 'scheduler.jar');
  const runtime = path.join(resources, 'runtime');
  const destination = path.join(build, 'scheduler');
  try {
    compileJava(classes, tool('javac'));
    fs.mkdirSync(resources);
    execFileSync(tool('jar'), ['--create', '--file', jar, '--main-class', 'ApiMain', '-C', classes, '.'],
      { stdio: 'inherit', windowsHide: true });
    const modules = execFileSync(tool('jdeps'), ['--print-module-deps', jar],
      { encoding: 'utf8', windowsHide: true }).trim();
    console.log(`Linking Java modules: ${modules}`);
    execFileSync(tool('jlink'), ['--module-path', path.join(jdk, 'jmods'), '--add-modules', modules,
      '--strip-debug', '--no-header-files', '--no-man-pages', '--output', runtime],
    { stdio: 'inherit', windowsHide: true });
    const license = path.join(jdk, 'LICENSE');
    if (fs.existsSync(license)) fs.copyFileSync(license, path.join(runtime, 'LICENSE'));
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(resources, destination);
    console.log(`Built scheduler.jar and Java runtime in ${destination}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

try {
  buildRuntime();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
