TONY TRADE AI V3.6.1 — research-only virtual trading.
1. Preserve existing database and run migration_v361.sql in Supabase SQL Editor.
2. Upload files preserving .github/workflows/paper-bot.yml.
3. Configure config.js with project URL and public anon/publishable key only.
4. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to GitHub Actions secrets. Never publish secret keys.
5. Run workflow manually with execute=false and inspect logs.
6. After audit, execute=true can test virtual orders. Scheduled runs remain dry-run by default.
The SQL function atomically records signal, journal, state and execution marker. Failed transactions roll back. Existing history is preserved, not repaired. This is not an audited production trading engine. No guaranteed returns. Public dashboard exposes virtual balances and journals. No broker integration.
