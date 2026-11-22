// Release step: apply pending database migrations, but only when a database is configured.
// Without DATABASE_URL the app runs in guest mode and there is nothing to migrate.
import { execSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.log('release: DATABASE_URL is not set, skipping migrations (guest mode).');
  process.exit(0);
}
console.log('release: applying database migrations…');
execSync('npx prisma migrate deploy', { stdio: 'inherit' });
