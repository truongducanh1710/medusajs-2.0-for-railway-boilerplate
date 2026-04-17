const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const MEDUSA_SERVER_PATH = path.join(process.cwd(), '.medusa', 'server');

// Check if .medusa/server exists - if not, build process failed
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  throw new Error('.medusa/server directory not found. This indicates the Medusa build process failed. Please check for build errors.');
}

// Copy pnpm-lock.yaml
fs.copyFileSync(
  path.join(process.cwd(), 'pnpm-lock.yaml'),
  path.join(MEDUSA_SERVER_PATH, 'pnpm-lock.yaml')
);

// Copy .env if it exists
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.copyFileSync(
    envPath,
    path.join(MEDUSA_SERVER_PATH, '.env')
  );
}

// Install dependencies
console.log('Installing dependencies in .medusa/server...');
execSync('pnpm i --prod --frozen-lockfile', {
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit'
});

// Run database migrations
console.log('Running database migrations...');
execSync('node_modules/.bin/medusa db:migrate', {
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit'
});
console.log('Migrations completed.');

// Sync SePay payment provider into VN region during build so runtime startup stays fast.
console.log('Syncing SePay region configuration...');
execSync('node_modules/.bin/medusa exec ../../src/scripts/sync-sepay-region.ts', {
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit'
});
console.log('SePay region sync completed.');
