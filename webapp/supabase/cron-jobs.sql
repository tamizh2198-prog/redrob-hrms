-- HRMS-22 (rev 4 security audit) — Supabase pg_cron/pg_net wiring for the
-- HRMS cron routes that need to run more often than daily.
--
-- Why this file exists: Vercel Cron (webapp/vercel.json) only supports
-- daily-or-coarser schedules on this project's plan (see README.md's
-- Architecture section). Everything that's safe to check once a day lives
-- in vercel.json. The three routes below are NOT safe to run only once a
-- day, so per the documented architecture they run from here instead, via
-- Supabase's pg_cron + pg_net extensions calling the same authenticated
-- api/cron/* routes Vercel Cron would call. This is exactly the kind of
-- wiring a source-only code review can't see (it lives in Supabase, not in
-- the repo) — which is how it went unregistered for as long as it did.
--
-- Routes scheduled here and why each needs sub-daily cadence:
--   * helpdesk-sla-check        — SLA warning/breach detection; the whole
--                                 point is catching breaches close to when
--                                 they happen, not up to 24h late.
--   * workflow-escalation       — same reasoning, for approval-workflow
--                                 step SLA breaches.
--   * profile-completion-reminders — the handler (see
--                                 src/server/modules/employee/profile-completion-reminder.ts)
--                                 explicitly checks a rolling 1-hour-wide
--                                 window that just crossed the 24h mark. If
--                                 this runs less often than hourly, most
--                                 employees' windows are skipped entirely
--                                 and they are never reminded — this isn't
--                                 just "less timely", it's a functional bug
--                                 at any coarser cadence.
--
-- How to run this:
--   1. In the Supabase dashboard for the PRODUCTION project, open the SQL
--      editor.
--   2. Store the cron secret in Vault (once) so it never has to be pasted
--      into a schedule body or committed to source control:
--
--        select vault.create_secret('<CRON_SECRET value from Vercel prod>', 'hrms_cron_secret');
--
--      (Re-run with vault.update_secret(...) if the secret ever rotates.)
--   3. Set APP_URL below to the deployed production URL, then run the rest
--      of this file as-is. Nothing below this point contains a real secret.
--
-- To verify after running:  select jobid, jobname, schedule, active from cron.job;
-- To remove a job:          select cron.unschedule('<jobname>');

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  app_url text := '<APP_URL>'; -- e.g. 'https://hrms.redrob.co' — set this before running
  cron_secret text;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'hrms_cron_secret';

  if cron_secret is null then
    raise exception 'hrms_cron_secret not found in Vault — run vault.create_secret(...) first (see comment above)';
  end if;

  if app_url = '<APP_URL>' then
    raise exception 'Set app_url to the production deployment URL before running this script';
  end if;

  perform cron.schedule(
    'helpdesk-sla-check',
    '0 * * * *',
    format(
      $sql$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', 'Bearer %s'));$sql$,
      app_url || '/api/cron/helpdesk-sla-check',
      cron_secret
    )
  );

  perform cron.schedule(
    'workflow-escalation',
    '0 * * * *',
    format(
      $sql$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', 'Bearer %s'));$sql$,
      app_url || '/api/cron/workflow-escalation',
      cron_secret
    )
  );

  perform cron.schedule(
    'profile-completion-reminders',
    '0 * * * *',
    format(
      $sql$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', 'Bearer %s'));$sql$,
      app_url || '/api/cron/profile-completion-reminders',
      cron_secret
    )
  );
end $$;
