#!/usr/bin/env python3
"""Copy T3 Code threads into Zen Staff on the same machine.

    python3 scripts/zen-import-t3.py [--t3-home ~/.t3] [--zen-home ~/.zen] [--apply]

Both apps run the same orchestration V2 schema (check: the effect_sql_migrations heads and the
orchestration_v2_* table definitions must match, the script refuses otherwise). Events are
pruned after a day, so the projection rows are the only full record of a thread: this script
copies them, per thread family (a thread and its subagent threads), into Zen's statev2.sqlite.

- T3 is never written: its database is read through SQLite's backup API from a read-only
  connection into a temporary snapshot, and its attachments are only copied.
- Zen is written only with --apply, only while its server is stopped (the pid in
  userdata/server-runtime.json must be gone), after a backup to
  userdata/backup-before-t3-import-<time>.sqlite.
- Projects map by workspace root. T3's "No project" (<t3 home>/scratch) maps to Zen's scratch
  project (<zen home>/scratch, created by Zen on the first chat without a project) or to
  --scratch-project.
- Claude threads stay continuable: the provider thread rows (native Claude session id) are
  copied, so the next message resumes the same Claude Code session. Live provider sessions are
  copied as stopped and active provider threads as idle; no process runs for them in Zen.
- A family with work still running in T3 (run, node, subagent, turn item, request...) is
  skipped; re-run later. A family whose Claude session Zen already has (Claude Code session
  import, `import:<instance>:<session>`) is skipped, so nothing is duplicated.
- Idempotent: a thread already in Zen is skipped. With --refresh, a family imported earlier and
  not touched in Zen since (same updated_at as recorded) is replaced by T3's newer copy.
- Each imported root thread gets a notice "Importat din T3 Code" as its first timeline item.
  The ledger is userdata/zen/t3-import.json.
"""
import argparse
import contextlib
import datetime
import json
import os
import pathlib
import shutil
import sqlite3
import sys
import tempfile

# Thread-scoped projection tables, in insert order. (table, thread column)
THREAD_TABLES = [
    ("orchestration_v2_projection_threads", "thread_id"),
    ("orchestration_v2_projection_runs", "thread_id"),
    ("orchestration_v2_projection_run_attempts", "thread_id"),
    ("orchestration_v2_projection_nodes", "thread_id"),
    ("orchestration_v2_projection_provider_sessions", "thread_id"),
    ("orchestration_v2_projection_provider_session_bindings", "thread_id"),
    ("orchestration_v2_projection_provider_threads", "thread_id"),
    ("orchestration_v2_projection_provider_turns", "thread_id"),
    ("orchestration_v2_projection_runtime_requests", "thread_id"),
    ("orchestration_v2_projection_messages", "thread_id"),
    ("orchestration_v2_projection_plans", "thread_id"),
    ("orchestration_v2_projection_turn_items", "thread_id"),
    ("orchestration_v2_turn_item_positions", "thread_id"),
    ("orchestration_v2_projection_checkpoint_scopes", "thread_id"),
    ("orchestration_v2_projection_checkpoints", "thread_id"),
    ("orchestration_v2_projection_context_handoffs", "thread_id"),
    ("orchestration_v2_projection_context_transfers", "source_thread_id"),
    ("orchestration_v2_projection_subagents", "thread_id"),
]
# Not copied: events/receipts (pruned tail, sequences are per database), effect outbox and
# launch workflows (pending side effects), legacy imports (v1 shells).

ACTIVE = {
    "orchestration_v2_projection_runs": ("queued", "preparing", "starting", "running", "waiting"),
    "orchestration_v2_projection_run_attempts": ("queued", "preparing", "starting", "running", "waiting"),
    "orchestration_v2_projection_nodes": ("pending", "starting", "running", "waiting"),
    "orchestration_v2_projection_provider_turns": ("pending", "starting", "running", "waiting"),
    "orchestration_v2_projection_runtime_requests": ("pending", "waiting"),
    "orchestration_v2_projection_turn_items": ("pending", "running", "waiting"),
    "orchestration_v2_projection_subagents": ("pending", "starting", "running", "waiting"),
    "orchestration_v2_projection_checkpoints": ("pending", "capturing"),
    "orchestration_v2_projection_context_handoffs": ("pending", "ready"),
    "orchestration_v2_projection_plans": ("pending", "running", "waiting"),
}

NOTICE_PREFIX = "t3-import:notice:"


def norm_path(value, windows):
    if value is None:
        return None
    text = os.path.normpath(value.replace("\\", "/")) if not windows else value.replace("/", "\\").rstrip("\\")
    return text.lower() if windows else text.rstrip("/")


def snapshot(db_path, into):
    """Consistent copy through the backup API; the source connection is read-only."""
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    dst = sqlite3.connect(into)
    with contextlib.closing(src), contextlib.closing(dst):
        src.backup(dst)
    return into


def schema_of(conn):
    rows = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE name LIKE 'orchestration_v2_%' AND sql IS NOT NULL"
    )
    return {name: " ".join(sql.split()) for name, sql in rows}


def columns(conn, table):
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def pid_alive(pid):
    if os.name == "nt":
        import subprocess

        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def iso_now():
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def main():
    home = pathlib.Path.home()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--t3-home", default=str(home / ".t3"))
    parser.add_argument("--zen-home", default=str(home / ".zen"))
    parser.add_argument("--zen-db", help="write this statev2.sqlite instead (a test copy); its folder gets the backup, attachments and ledger")
    parser.add_argument("--apply", action="store_true", help="write (Zen server must be stopped)")
    parser.add_argument("--refresh", action="store_true", help="replace untouched earlier imports with newer T3 copies")
    parser.add_argument("--scratch-project", help="Zen project id for T3 'No project' threads")
    parser.add_argument("--machine", default=os.uname().nodename if hasattr(os, "uname") else os.environ.get("COMPUTERNAME", "pc"))
    parser.add_argument("--include-active", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    windows = os.name == "nt"
    t3_user = pathlib.Path(args.t3_home) / "userdata"
    zen_user = pathlib.Path(args.zen_home) / "userdata"
    zen_db_path = pathlib.Path(args.zen_db) if args.zen_db else zen_user / "statev2.sqlite"
    # Backup, attachments and ledger live next to the database written (a test copy keeps them).
    zen_out = zen_db_path.parent
    ledger_path = zen_out / "zen" / "t3-import.json"

    if args.apply and not args.zen_db:
        runtime = load_json(zen_user / "server-runtime.json", {})
        pid = runtime.get("pid")
        if pid and pid_alive(int(pid)):
            sys.exit(f"Zen server (pid {pid}) is running; stop it first. Nothing written.")

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="zen-import-t3-"))
    try:
        t3 = sqlite3.connect(snapshot(t3_user / "statev2.sqlite", str(tmp / "t3.sqlite")))
        if args.apply:
            zen = sqlite3.connect(str(zen_db_path))
        else:
            zen = sqlite3.connect(snapshot(zen_db_path, str(tmp / "zen.sqlite")))
        return run(args, windows, t3, zen, t3_user, zen_user, zen_out, ledger_path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run(args, windows, t3, zen, t3_user, zen_user, zen_out, ledger_path):
    t3_schema, zen_schema = schema_of(t3), schema_of(zen)
    drift = sorted(k for k in set(t3_schema) | set(zen_schema) if t3_schema.get(k) != zen_schema.get(k))
    if drift:
        sys.exit(f"Schema differs between T3 and Zen ({', '.join(drift[:8])}); refusing.")

    # Projects: T3 id -> Zen id by workspace root.
    zen_projects = {}
    for pid, title, root in zen.execute(
        "SELECT project_id, title, workspace_root FROM projection_projects WHERE deleted_at IS NULL"
    ):
        zen_projects.setdefault(norm_path(root, windows), (pid, title))
    zen_titles = {pid: title for pid, title, _ in zen.execute("SELECT project_id, title, workspace_root FROM projection_projects")}
    t3_scratch = norm_path(str(t3_user.parent / "scratch"), windows)
    zen_scratch = norm_path(str(zen_user.parent / "scratch"), windows)
    project_map, t3_titles = {}, {}
    for pid, title, root in t3.execute("SELECT project_id, title, workspace_root FROM projection_projects"):
        t3_titles[pid] = title
        key = norm_path(root, windows)
        if key == t3_scratch:
            if args.scratch_project:
                project_map[pid] = args.scratch_project
            elif zen_scratch in zen_projects:
                project_map[pid] = zen_projects[zen_scratch][0]
        elif key in zen_projects:
            project_map[pid] = zen_projects[key][0]

    companies = load_json(zen_user / "zen" / "companies.json", {})
    company_names = {c["id"]: c["name"] for c in companies.get("companies", [])}
    company_of = lambda pid: company_names.get(companies.get("projects", {}).get(pid), "(fără companie)")

    # Families: root thread + its subagent threads.
    threads = {}
    for tid, project_id, title, created, updated, archived, deleted, payload in t3.execute(
        "SELECT thread_id, project_id, title, created_at, updated_at, archived_at, deleted_at, payload_json "
        "FROM orchestration_v2_projection_threads"
    ):
        p = json.loads(payload)
        root = (p.get("lineage") or {}).get("rootThreadId") or tid
        threads[tid] = dict(id=tid, project=project_id, title=title, created=created, updated=updated,
                            archived=archived, deleted=deleted, root=root, payload=p)
    families = {}
    for t in threads.values():
        root = t["root"] if t["root"] in threads else t["id"]
        families.setdefault(root, []).append(t["id"])

    zen_threads = {tid: upd for tid, upd in zen.execute("SELECT thread_id, updated_at FROM orchestration_v2_projection_threads")}
    owned_native = {}
    for tid, native in zen.execute(
        "SELECT thread_id, json_extract(payload_json, '$.nativeThreadRef.nativeId') "
        "FROM orchestration_v2_projection_provider_threads WHERE thread_id IS NOT NULL"
    ):
        if native:
            owned_native[native] = tid
    ledger = load_json(ledger_path, {"version": 1, "threads": {}})

    def family_rows(table, col, ids):
        marks = ",".join("?" * len(ids))
        return t3.execute(f"SELECT * FROM {table} WHERE {col} IN ({marks})", ids)

    def family_active(ids):
        marks = ",".join("?" * len(ids))
        hits = []
        for table, statuses in ACTIVE.items():
            smarks = ",".join("?" * len(statuses))
            n = t3.execute(
                f"SELECT count(*) FROM {table} WHERE thread_id IN ({marks}) AND status IN ({smarks})",
                [*ids, *statuses],
            ).fetchone()[0]
            if n:
                hits.append(f"{table.replace('orchestration_v2_projection_', '')}={n}")
        return hits

    plan, skipped = [], []
    for root, ids in sorted(families.items(), key=lambda kv: threads[kv[0]]["created"]):
        t = threads[root]
        label = f"{t3_titles.get(t['project'], t['project'])}: {t['title'][:60]}"
        natives = [n for (n,) in t3.execute(
            f"SELECT json_extract(payload_json, '$.nativeThreadRef.nativeId') FROM orchestration_v2_projection_provider_threads "
            f"WHERE thread_id IN ({','.join('?' * len(ids))})", ids) if n]
        foreign = [owned_native[n] for n in natives if n in owned_native and owned_native[n] not in ids]
        if foreign:
            skipped.append((label, len(ids), f"Claude session already in Zen as {foreign[0]}"))
            continue
        target = project_map.get(t["project"])
        if target is None:
            skipped.append((label, len(ids), f"no Zen project for T3 project '{t3_titles.get(t['project'])}'"))
            continue
        replace = False
        if root in zen_threads:
            entry = ledger["threads"].get(root)
            untouched = entry is not None and entry.get("zenUpdatedAt") == zen_threads[root]
            if args.refresh and untouched and t["updated"] > entry.get("sourceUpdatedAt", ""):
                replace = True
            else:
                why = "already imported" if entry else "thread id already in Zen"
                if entry and not untouched:
                    why += " (changed in Zen since)"
                elif entry and t["updated"] > entry.get("sourceUpdatedAt", ""):
                    why += " (newer in T3: use --refresh)"
                skipped.append((label, len(ids), why))
                continue
        active = family_active(ids)
        if active and not args.include_active:
            skipped.append((label, len(ids), "work still running in T3 (" + ", ".join(active) + "); re-run later"))
            continue
        plan.append(dict(root=root, ids=ids, target=target, replace=replace, label=label))

    # Report.
    print(f"T3 threads: {len(threads)} in {len(families)} families (root + subagent threads)")
    by_project = {}
    for item in plan:
        key = item["target"]
        n = by_project.setdefault(key, [0, 0])
        n[0] += 1
        n[1] += len(item["ids"])
    print("\nTo import" + (" (applying)" if args.apply else " (dry run)") + ":")
    for pid, (roots, total) in sorted(by_project.items(), key=lambda kv: -kv[1][1]):
        print(f"  {zen_titles.get(pid, pid)} [{company_of(pid)}]: {roots} threads (+{total - roots} subagent)")
    for item in plan:
        print(f"    {'refresh' if item['replace'] else 'new'}  {item['label']}  ({len(item['ids'])} threads)")
    if skipped:
        print("\nSkipped:")
        for label, n, why in skipped:
            print(f"  {label}  ({n} threads): {why}")
    if not args.apply or not plan:
        return 0

    # Backup, then write each family in its own transaction.
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = zen_out / f"backup-before-t3-import-{stamp}.sqlite"
    with contextlib.closing(sqlite3.connect(str(backup))) as dst:
        zen.backup(dst)
    print(f"\nBackup: {backup}")

    zen_cols = {table: columns(zen, table) for table, _ in THREAD_TABLES}
    attachments_dir_src, attachments_dir_dst = t3_user / "attachments", zen_out / "attachments"
    attachment_files = {}
    if attachments_dir_src.is_dir():
        for f in attachments_dir_src.iterdir():
            attachment_files.setdefault(f.stem, []).append(f)
    copied_files = 0
    now = iso_now()
    for item in plan:
        ids = item["ids"]
        root = item["root"]
        zen.execute("BEGIN")
        try:
            if item["replace"]:
                marks = ",".join("?" * len(ids))
                for table, col in reversed(THREAD_TABLES):
                    zen.execute(f"DELETE FROM {table} WHERE {col} IN ({marks})", ids)
            attachment_ids = set()
            for table, col in THREAD_TABLES:
                cur = family_rows(table, col, ids)
                src_cols = [d[0] for d in cur.description]
                dst_cols = [c for c in zen_cols[table] if c in src_cols]
                for row in cur.fetchall():
                    rec = dict(zip(src_cols, row))
                    payload = json.loads(rec["payload_json"]) if rec.get("payload_json") else None
                    if table == "orchestration_v2_projection_threads":
                        rec["project_id"] = item["target"]
                        payload["projectId"] = item["target"]
                    elif table == "orchestration_v2_projection_provider_sessions" and rec["status"] != "stopped":
                        rec["status"] = payload["status"] = "stopped"
                    elif table == "orchestration_v2_projection_provider_threads" and rec["status"] == "active":
                        rec["status"] = payload["status"] = "idle"
                    if payload is not None:
                        for att in payload.get("attachments") or []:
                            if isinstance(att, dict) and att.get("id"):
                                attachment_ids.add(att["id"])
                        rec["payload_json"] = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                    zen.execute(
                        f"INSERT INTO {table} ({','.join(dst_cols)}) VALUES ({','.join('?' * len(dst_cols))})",
                        [rec[c] for c in dst_cols],
                    )
            # Marker: a notice before the first timeline item of the root thread.
            first = zen.execute(
                "SELECT min(ordinal) FROM orchestration_v2_projection_turn_items WHERE thread_id = ?", [root]
            ).fetchone()[0]
            first_pos = zen.execute(
                "SELECT min(ordinal) FROM orchestration_v2_turn_item_positions WHERE thread_id = ?", [root]
            ).fetchone()[0]
            created = threads[root]["created"]
            if (first is None or first > 0) and (first_pos is None or first_pos > 0):
                notice_id = f"{NOTICE_PREFIX}{root}"
                message = (
                    f"Importat din T3 Code ({args.machine}) pe {now[:10]}: istoricul complet al firului. "
                    "Un mesaj nou continuă aceeași sesiune Claude Code."
                )
                notice = {
                    "id": notice_id, "threadId": root, "runId": None, "nodeId": None,
                    "providerThreadId": None, "providerTurnId": None, "nativeItemRef": None,
                    "parentItemId": None, "ordinal": 0, "status": "completed", "title": None,
                    "startedAt": created, "completedAt": created, "updatedAt": created,
                    "type": "system_notice", "message": message,
                }
                zen.execute(
                    "INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id, run_id, node_id, "
                    "provider_thread_id, provider_turn_id, parent_item_id, ordinal, type, status, updated_at, payload_json) "
                    "VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 'system_notice', 'completed', ?, ?)",
                    [notice_id, root, created, json.dumps(notice, ensure_ascii=False, separators=(",", ":"))],
                )
                zen.execute(
                    "INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal) VALUES (?, ?, 0)",
                    [root, notice_id],
                )
            zen.execute("COMMIT")
        except Exception:
            zen.execute("ROLLBACK")
            raise
        for att_id in attachment_ids:
            for f in attachment_files.get(att_id, []):
                target = attachments_dir_dst / f.name
                if not target.exists():
                    attachments_dir_dst.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, target)
                    copied_files += 1
        zen_updated = zen.execute(
            "SELECT updated_at FROM orchestration_v2_projection_threads WHERE thread_id = ?", [root]
        ).fetchone()[0]
        ledger["threads"][root] = {
            "title": threads[root]["title"],
            "machine": args.machine,
            "t3Project": t3_titles.get(threads[root]["project"]),
            "zenProjectId": item["target"],
            "threadIds": ids,
            "sourceUpdatedAt": threads[root]["updated"],
            "zenUpdatedAt": zen_updated,
            "importedAt": now,
        }
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_ledger = ledger_path.with_suffix(".json.tmp")
    tmp_ledger.write_text(json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp_ledger, ledger_path)
    zen.close()
    print(f"Imported {len(plan)} families, {sum(len(i['ids']) for i in plan)} threads; {copied_files} attachment files copied.")
    print(f"Ledger: {ledger_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
