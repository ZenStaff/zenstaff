---
learn:
  - Why RLS is the only wall between the browser and your tables
  - Which policy mistakes agents make most often
  - What skips RLS without you noticing
  - How to test policies the way an attacker would
---

## Why RLS is the whole security model

With Supabase, the browser talks to Postgres through the auto-generated API using the public `anon` (publishable) key. Anyone can copy that key from your bundle.

The only thing between them and your tables is Row Level Security. If a policy is wrong, there's no backend to catch it.

:::warn
Agents write a lot of migrations. They also tend to "fix" a permission error by loosening the policy until the error goes away.
:::

## Policy mistakes

- **RLS not enabled.** A table created in a migration without `alter table ... enable row level security` is readable and writable by anyone with the anon key.
- **`using (true)`.** The "make it work" policy. It means every row, for every role the policy applies to.
- **Only a SELECT policy, or no `WITH CHECK`.** `USING` filters which rows you can see or touch. `WITH CHECK` validates the new values. An UPDATE policy without `WITH CHECK` lets a user move a row to another `user_id` or tenant.
- **Self-elevation.** A `profiles` table with a `role` column and a policy "users can update their own profile". The user sends `{ role: "admin" }` and is now an admin. Keep roles in a separate table that users can't write, or restrict columns with `grant update (display_name, avatar_url)`.

:::dont
```sql
create policy "update own" on profiles for update using (auth.uid() = id);
```
:::

:::do
```sql
create policy "update own" on profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
revoke update on profiles from authenticated;
grant update (display_name, avatar_url) on profiles to authenticated;
```
:::

## What skips RLS

- **SECURITY DEFINER functions.** They run as the owner and skip RLS. Without `set search_path = ''` and an explicit `auth.uid()` check inside, any logged-in user (or anon, if executable) can call them via `rpc()`. Revoke execute from `anon` and `public` when they aren't meant for them.
- **Views.** A plain view runs with the creator's rights and ignores RLS on the base table. Use `create view ... with (security_invoker = true)` (Postgres 15+).
- **Storage buckets set to public**, holding invoices or ID scans.

:::warn
The service_role key in client code bypasses all RLS. It belongs only on the server or in edge functions.
:::

## Test as the attacker

Don't test policies in the SQL editor as `postgres`. That role bypasses RLS. Test as the real roles, inside `begin;` and `rollback;`:

:::example Testing with the real roles
```sql
set local role anon;
select * from invoices;          -- expect 0 rows
set local role authenticated;
set local request.jwt.claims = '{"sub":"<other-user-uuid>"}';
update profiles set role = 'admin' where id = '<other-user-uuid>';  -- expect error
```
:::

:::tip
Also check the Security Advisor in the Supabase dashboard: it flags tables without RLS and definer views. Ask the agent to write a pgTAP test for each new policy, not just the policy.
:::

## Try it now

:::try
Start an RLS audit on the practice project: a migration file with several of these mistakes and a client file that uses the service role key. It's a static review, nothing connects to a database. The agent gives you each finding with file:line, severity, how it can be abused and a SQL fix.
:::

:::quiz
The agent hit a permission error and changed the policy to `using (true)`. It works now. What do you do?

- [ ] Leave it, the error is gone.
- [x] Reject the change: the policy now gives every row to every role.
- [ ] Just add a comment in the migration.

> The error went away because the protection went away. Ask for a policy that checks `auth.uid()`.
:::

:::quiz
The `profiles` table has a `role` column and users can update their own profile. What is the risk?

- [ ] None, users only update their own row.
- [ ] Only that they can pick a rude display name.
- [x] A user sends `role: "admin"` and becomes an admin.

> Keep roles in a separate table, or restrict columns with `grant update (...)`.
:::

:::quiz
You test your policies in the SQL editor and see every row. What does that mean?

- [ ] The policies are definitely wrong.
- [x] You are probably running as `postgres`, which bypasses RLS. Test with `set local role anon`.
- [ ] Supabase turns RLS off in the editor for everyone, so it's normal.

> Only the real roles (`anon`, `authenticated`) show you what an attacker sees.
:::
