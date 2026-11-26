const path = require('node:path');

const executableName = name => process.platform === 'win32' ? name + '.exe' : name;
const jdkTool = name => process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', executableName(name)) : name;

const development = {
  executable: process.env.SCHEDULER_JAVA || jdkTool('java'),
  compiler: process.env.SCHEDULER_JAVAC || jdkTool('javac'),
  classesPath: path.resolve(process.env.SCHEDULER_CLASSES ||
    path.join(__dirname, '..', 'bin', 'ui', 'classes')),
  workingDirectory: path.resolve(__dirname, '..'),
  timeoutMs: 120000
};

// Native child processes need real files outside app.asar.
function packagedJava(resourcesPath) {
  const directory = path.join(resourcesPath, 'scheduler');
  return {
    executable: path.join(directory, 'runtime', 'bin', 'java.exe'),
    classesPath: path.join(directory, 'scheduler.jar'),
    workingDirectory: directory,
    timeoutMs: development.timeoutMs
  };
}

module.exports = Object.assign(development, { packagedJava });
