const { spawn } = require('node:child_process');
const javaConfig = require('./java-config');

function runJava(input, config = javaConfig, signal) {
  return new Promise((resolve, reject) => {
    let payload;
    try {
      payload = JSON.stringify(input);
      if (!payload) throw new Error('The request must be a JSON object.');
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(config.executable, ['-cp', config.classesPath, 'ApiMain'], {
      cwd: config.workingDirectory,
      windowsHide: true,
      shell: false,
      signal
    });
    let stdout = '';
    let stderr = '';
    let inputError;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, config.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    // Java may exit before it consumes stdin. Report its stderr/JSON on close.
    child.stdin.on('error', error => { inputError = error; });
    child.once('error', error => {
      clearTimeout(timer);
      reject(new Error(error.code === 'ENOENT'
        ? `Cannot start Java at "${config.executable}".`
        : `Cannot start Java: ${error.message}`));
    });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Java exceeded the ${config.timeoutMs / 1000}-second timeout.`));
        return;
      }
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        reject(new Error(stderr.trim() ||
          `Java returned no valid JSON (exit ${code ?? exitSignal}).`));
        return;
      }
      if (result && typeof result.error === 'string') {
        reject(new Error(result.error));
      } else if (code !== 0) {
        reject(new Error(stderr.trim() || `Java exited with code ${code ?? exitSignal}.`));
      } else if (inputError) {
        reject(new Error(`Unable to write the request to Java: ${inputError.message}`));
      } else if (!result || !Array.isArray(result.events) ||
          !Array.isArray(result.results) || !result.averages || typeof result.averages !== 'object') {
        reject(new Error('Java returned an unexpected response.'));
      } else {
        resolve(result);
      }
    });
    child.stdin.end(payload + '\n', 'utf8');
  });
}

module.exports = { runJava };
