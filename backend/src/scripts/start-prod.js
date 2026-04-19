const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const medusaServerPath = path.join(process.cwd(), '.medusa', 'server');
const medusaBin = process.platform === 'win32'
  ? path.join(medusaServerPath, 'node_modules', '.bin', 'medusa.cmd')
  : path.join(medusaServerPath, 'node_modules', '.bin', 'medusa');

if (!fs.existsSync(medusaServerPath)) {
  console.error(`[startup] Missing Medusa build output directory: ${medusaServerPath}`);
  process.exit(1);
}

if (!fs.existsSync(medusaBin)) {
  console.error(`[startup] Missing Medusa executable: ${medusaBin}`);
  process.exit(1);
}

console.log(`[startup] Medusa server directory: ${medusaServerPath}`);
console.log(`[startup] Medusa executable: ${medusaBin}`);
console.log('[startup] Launching medusa start --verbose');

const child = spawn(medusaBin, ['start', '--verbose'], {
  cwd: medusaServerPath,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('[startup] Failed to launch medusa:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[startup] Medusa process exited with signal: ${signal}`);
    process.exit(1);
  }

  if (code !== 0) {
    console.error(`[startup] Medusa process exited with code: ${code}`);
    process.exit(code || 1);
  }

  console.log('[startup] Medusa process exited cleanly.');
});
