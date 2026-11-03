// The production guard's rules for the Vercel connector (kit 1.9, D1; moved
// out of guard-production.mjs in R1-3 so the guard file stops growing).
//
// Until kit 1.9 checkMcp passed every call without a Supabase ref, so
// request_promote or create_deployment reached production with only the
// settings rules in the way (~/pylos/notes/connectors.md, 2 Nov 2026). Two
// names for one connector: the desktop app's `mcp__<uuid>__<tool>` and the
// CLI's `mcp__claude_ai_Vercel__<tool>` (a plain `mcp__vercel__` server counts
// as named too).
//
// Which uuid is Vercel's? Other connectors are uuids too (Supabase, Notion,
// Burrow, hotels...), and Pollux's and delphi's uuids differ, so the hook
// keeps no uuid constant. It reads (never writes) the permission rules in
// ~/.claude/settings.json and the project's .claude/settings*.json: a uuid
// whose rules name a tool only Vercel has (request_promote, request_rollback,
// search_vercel_documentation) is Vercel's, and gets the named connector's
// rules, the unknown-write ask included (R1-1). A uuid the settings don't name
// is Vercel's only when its tool is one of Vercel's known writes. Never when
// the call carries a Supabase-shaped ref (Supabase has a pause_project too).
// On a Vercel server an unknown write asks (Alexander, 3 Nov: "Ask, deny
// unattended").
//
// Reads (the verbs below) get no decision: they stay on the settings allow
// list (and get_deployment, list_deployments on the drive's read list), and
// the guard adds no allow for them. The secret-revealing reads the settings
// ask about (get_project_env and the like) stay the settings' asks.
//
// Logging: every ask and deny reaches .claude/guard-decisions.log through the
// guard's logDecision, armed or not. The one allow (a production write under
// his /one-ring go) needs an armed release (R1-4), so record() always has the
// release's log to write it to.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GO_HOURS } from './one-ring-go.mjs'

const VERCEL_NAMED_RE = /^mcp__(?:claude_ai_)?vercel__/i
const UUID_SERVER_RE = /^mcp__([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})__/i
const READ_RE = /^(?:get|list|search|count|aggregate|read)[_-]/
// Tools no other connector has: a settings rule naming one marks its uuid as Vercel's.
const VERCEL_ONLY = ['request_promote', 'request_rollback', 'search_vercel_documentation']
const RULE_RE = new RegExp(`^mcp__([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})__(?:${VERCEL_ONLY.join('|')})(?:$|\\()`, 'i')

// The settings' other reads, and filter_project_envs, a read the settings ask
// about because it shows secrets (theirs to ask, not the guard's).
const VERCEL_READ = new Set(['artifact_query', 'git_namespaces', 'web_fetch_vercel_url', 'filter_project_envs'])
// What a production deploy may do: ask, and his /one-ring for the armed
// release is the yes, as for scripts/full-auto.sh deploy. A re-run check or CI
// invocation can promote a build, so those two count here (R1-8).
const VERCEL_PROD_WRITES = new Set([
  'request_promote', 'request_rollback', 'create_deployment', 'cancel_deployment', 'assign_alias',
  'rerequest_check', 'retry_vercel_ci_invocation',
  'create_project_env', 'edit_project_env',
  'update_project', 'pause_project', 'unpause_project',
  'create_record', 'update_record', 'replace_domain_dns_records', 'add_project_domain', 'verify_project_domain',
  'put_firewall_config', 'update_firewall_config', 'update_attack_challenge_mode',
])
// Production writes that cost money: they ask, and no deploy go covers a
// purchase (Alexander's cost rule: never paid by accident).
const VERCEL_PAID = new Set(['buy_domain', 'create_or_transfer_domain'])
// Vercel's other writes (the 2 Nov tool list): they ask, with no go, and they
// are how a uuid the settings don't name is known as Vercel's.
const VERCEL_WRITES = new Set([
  'add_route', 'edit_route', 'generate_route', 'stage_routes', 'update_route_versions',
  'stage_redirects', 'restore_redirects', 'update_bulk_redirect_version',
  'invalidate_by_tags', 'invalidate_by_src_images',
  'create_edge_config', 'update_edge_config', 'patch_edge_config_items', 'restore_edge_config_backup', 'create_edge_config_token',
  'create_flag', 'update_flag', 'update_flag_segment', 'update_flag_settings', 'create_flags_project_connection', 'create_sdk_key',
  'start_rolling_release', 'approve_rolling_release_stage', 'complete_rolling_release', 'update_rolling_release_config',
  'create_drain', 'update_drain', 'test_drain',
  'create_project', 'create_git_project', 'accept_project_transfer_request',
  'update_project_protection_bypass', 'patch_url_protection_bypass', 'issue_cert',
  'activate_kms_signing_key', 'create_kms_issuer', 'create_kms_issuer_policy', 'create_kms_signing_key',
  'revoke_kms_signing_key', 'update_kms_issuer', 'update_kms_issuer_policy',
  'update_connector', 'upsert_connector_project_connection', 'authorize_team_access', 'authorize_team_sso',
  'create_sandboxes_v2', 'create_sandboxes_v3', 'create_sandboxes_v4', 'update_sandbox',
  'create_sandboxes_sessions_by_session_id_snapshot_v2', 'create_sandboxes_sessions_by_session_id_snapshot_v3',
  'create_session_directory', 'run_session_command', 'kill_session_command', 'stop_session', 'extend_session_timeout',
  'update_session_network_policy', 'write_session_files',
  'upload_artifact', 'upload_file', 'create_storage_stores_blob',
  'add_toolbar_reaction', 'change_toolbar_thread_resolve_status', 'edit_toolbar_message', 'reply_to_toolbar_thread',
  'create_observability_query', 'create_trace_session', 'record_events', 'submit_feedback',
  'import-claude-dashboard-from-url', 'import-claude-design-from-url', 'import-claude-motion-from-url',
])
export const VERCEL_TOOLS = { VERCEL_READ, VERCEL_PROD_WRITES, VERCEL_PAID, VERCEL_WRITES, READ_RE }

// The settings files whose rules can name the uuid: the user's and the project's.
export const settingsFiles = (claudeDir, home = homedir()) => [join(home, '.claude', 'settings.json'), join(claudeDir, 'settings.json'), join(claudeDir, 'settings.local.json')]

// Read once per process and file list: the guard runs once per tool call, and
// a settings change takes a new session anyway. A missing or unparseable file
// names no uuid; this never throws.
const cache = new Map()
export function vercelUuids(files) {
  const key = files.join('\0')
  if (cache.has(key)) return cache.get(key)
  const out = new Set()
  for (const f of files) {
    try {
      if (!existsSync(f)) continue
      const p = JSON.parse(readFileSync(f, 'utf8'))?.permissions ?? {}
      for (const list of [p.allow, p.ask, p.deny]) {
        if (!Array.isArray(list)) continue
        for (const rule of list) {
          const m = typeof rule === 'string' && RULE_RE.exec(rule)
          if (m) out.add(m[1].toLowerCase())
        }
      }
    } catch { /* this file names no uuid */ }
  }
  cache.set(key, out)
  return out
}

/**
 * The guard's decision on a Vercel connector call, or null when it isn't one
 * (or is a read). `h` is the guard's own helpers, so a decision logs and reads
 * like every other production call: { record, logLine, prodCall, deny, refRe }.
 */
export function vercelCall(tool, args, ctx, h) {
  const name = tool.slice(tool.lastIndexOf('__') + 2)
  const ref = args.project_id ?? args.project_ref
  if (typeof ref === 'string' && h.refRe.test(ref)) return null
  const prodWrite = VERCEL_PROD_WRITES.has(name)
  const known = prodWrite || VERCEL_PAID.has(name) || VERCEL_WRITES.has(name)
  const uuid = UUID_SERVER_RE.exec(tool)?.[1]?.toLowerCase()
  let named = VERCEL_NAMED_RE.test(tool)
  if (!named && uuid && !known) {
    let uuids = new Set()
    try { uuids = ctx.vercelUuids() } catch { /* none known */ }
    named = uuids.has(uuid)
  }
  if (!named && !(uuid && known)) return null
  if (READ_RE.test(name) || VERCEL_READ.has(name)) return null
  const what = `${tool} ${JSON.stringify(args)}`
  ctx.logged = true
  const kind = prodWrite ? 'a production write' : VERCEL_PAID.has(name) ? 'a purchase' : known ? 'a write' : 'a write the guard does not know'
  let why = `${kind}, which no deploy go covers`
  if (prodWrite) {
    let typed = null
    let marker = null
    if (!ctx.subagent) {
      try { typed = ctx.humanGo() } catch { typed = null }
      try { marker = ctx.marker() } catch { marker = null }
    }
    // His go counts only for the release that is armed (R1-4), as deployCall
    // reads it: any /one-ring of the last hours would otherwise open every
    // production write.
    if (typed && marker && String(marker.version) === typed.arg) {
      h.record(ctx, h.logLine(ctx, 'allow', what, `his typed /one-ring ${typed.arg}, release ${marker.version} armed`))
      return h.prodCall(ctx, { decision: 'allow', reason: `Vercel ${name} is a production write, and Alexander typed /one-ring ${typed.arg} in this session at ${new Date(typed.at).toISOString()} for the armed release ${marker.version}: that is the go. Logged.` })
    }
    why = ctx.subagent ? 'from a subagent, where no /one-ring go counts'
      : !typed ? `no /one-ring typed by him in this session in the last ${GO_HOURS} hours`
      : !marker ? `his /one-ring ${typed.arg} has no armed release`
      : `his /one-ring names ${typed.arg}, and the armed release is ${marker.version}`
  }
  h.record(ctx, h.logLine(ctx, ctx.unattended ? 'deny' : 'ask', what, why))
  if (ctx.unattended) return h.prodCall(ctx, h.deny(`Vercel ${name} is ${kind} on the connector, and ${why}. Bypass and don't-ask modes can't ask him: run it from a Manual or Auto mode session${prodWrite ? ', or through /one-ring' : ''}.`))
  return h.prodCall(ctx, { decision: 'ask', reason: `Vercel ${name} is ${kind} on the connector (it may change production): ${why}, so your yes here is the go.` })
}
