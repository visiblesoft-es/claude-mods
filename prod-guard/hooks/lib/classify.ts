// Pure logic: nothing here talks to the engine.
//
// Deciding what a shell command does cannot be exact, so a command that touches
// production counts as a write unless every part of it matches the read-only
// rules below. They are a best effort against mistakes, not a security boundary,
// and a script's contents are out of reach: a script that reaches production by
// itself is caught only through `patterns`.

export type Targets = { hosts: string[]; contexts: string[]; patterns: RegExp[]; invalid: string[] }

export type Assessment = { target: string; isWrite: boolean }

export function parseList(value: unknown): string[] {
  return typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : []
}

// Patterns are separated by spaces, not commas: a regular expression may hold a
// comma, as in `\d{1,3}`.
function parsePatterns(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value.split(/\s+/).map(s => s.replace(/,$/, '')).filter(Boolean)
}

export function parseTargets(hosts: unknown, contexts: unknown, patterns: unknown): Targets {
  const compiled: RegExp[] = []
  const invalid: string[] = []
  for (const source of parsePatterns(patterns)) {
    try {
      compiled.push(new RegExp(source))
    } catch {
      invalid.push(source)
    }
  }
  return { hosts: parseList(hosts), contexts: parseList(contexts), patterns: compiled, invalid }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SEPARATORS = /\|\||&&|[;|&\n]/
const DOCKER = /(?:^|[\s;&|(`'"/=])docker(?:-compose)?(?:\s|$)/

export function mentionsDocker(command: string): boolean {
  return DOCKER.test(command)
}

const CONTEXT_NAME = /(?:--context[=\s]+|\bdocker\s+-c\s+|DOCKER_CONTEXT=|docker\s+context\s+use\s+)["']?([\w.-]+)/g

function namedContexts(text: string): string[] {
  return [...text.matchAll(CONTEXT_NAME)].map(m => m[1]!)
}

function matchesHost(command: string, host: string): boolean {
  const h = escape(host)
  // An IP or a domain counts anywhere. A bare alias counts only as the target
  // of a remote tool: an alias may also be the name of a folder.
  if (host.includes('.')) return new RegExp(`(?<![\\w.-])${h}(?![\\w-]|\\.\\w)`, 'i').test(command)
  const user = '(?:[\\w.-]+@)?'
  return new RegExp(
    `\\b(?:ssh|scp|rsync|sftp)\\b[^\\n;&|]*?(?<![\\w.\\-/])${user}${h}(?![\\w.\\-/])|ssh://${user}${h}(?![\\w.-])`,
    'i',
  ).test(command)
}

export function findTarget(command: string, t: Targets, currentContext: string | null): string | null {
  for (const host of t.hosts) if (matchesHost(command, host)) return host
  // Every context the command names counts, wherever it is.
  for (const name of namedContexts(command)) if (t.contexts.includes(name)) return `docker:${name}`
  // Any docker command that names none uses the context in use.
  if (currentContext !== null && t.contexts.includes(currentContext)) {
    const uses = command
      .replace(/['"]/g, '')
      .split(SEPARATORS)
      .some(part => mentionsDocker(part) && namedContexts(part).length === 0)
    if (uses) return `docker:${currentContext}`
  }
  for (const p of t.patterns) if (p.test(command)) return p.source
  return null
}

// Words that only read, whatever their arguments.
const READ_WORDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'ps', 'df', 'du', 'free', 'uptime', 'whoami', 'id', 'stat',
  'wc', 'cut', 'tr', 'echo', 'printf', 'pwd', 'which', 'uname', 'cd', 'true', 'netstat', 'lsof', 'nproc', 'ping',
])

// The rest read only with certain arguments.
const READ_RULES: Record<string, (segment: string) => boolean> = {
  date: s => /^date(?:\s+(?:\+\S+|%\S+|-u|-R|--utc|-I\S*|--iso-8601\S*))*$/.test(s),
  hostname: s => /^hostname(?:\s+-[fiIsA]+)?$/.test(s),
  uniq: s => /^uniq(?:\s+-\S+)*$/.test(s),
  ss: s => !/\s(?:-[a-zA-Z]*K|--kill)\b/.test(s),
  rg: s => !/\s--(?:pre|hostname-bin)\b/.test(s),
  sort: s => !/\s(?:-[a-zA-Z]*o|--output|--compress-program)/.test(s),
  sed: s => /^sed\s+-n\s+\d+(?:,\d+)?p(?:\s+[^-\s]\S*)*$/.test(s),
  find: s => !/\s-(?:exec|execdir|ok|okdir|delete|fprint\w*|fls)\b/.test(s),
  journalctl: s => !/\s--(?:vacuum-\w+|rotate|flush|sync|relinquish-var|smart-relinquish-var|setup-keys|update-catalog)\b/.test(s),
  systemctl: s => /^systemctl\s+(?:status|is-active|is-enabled|list-units|list-timers|show)\b/.test(s),
  git: s => /^git\s+(?:status|log|diff|show|rev-parse|remote\s+-v)(?:\s|$)/.test(s) && !/\s--(?:output|ext-diff)\b/.test(s),
  curl: isReadCurl,
  docker: s => DOCKER_READ.test(s.replace(DOCKER_GLOBAL, '')),
}

const DOCKER_GLOBAL = /^(?:docker)(?:\s+(?:--context[=\s]\S+|-c\s+\S+|-H\s+\S+|--host[=\s]\S+))*/
const DOCKER_READ =
  /^\s+(?:ps|logs|inspect|images|stats|top|port|version|info|history|diff|(?:container|image|service|stack|network|volume|node|system|context)\s+(?:ls|ps|logs|inspect|df|show)|compose(?:\s+(?:-f\s+\S+|--file[=\s]\S+|-p\s+\S+|--project-name[=\s]\S+|--env-file[=\s]\S+))*\s+(?:ps|logs|config|top|images|ls))(?:\s|$)/

const CURL_FLAGS = /^-[sSIikLfv]+$/
const CURL_FLAGS_THEN_VALUE = /^-[sSIikLfv]*[mw]$/
const CURL_FLAGS_THEN_OUTPUT = /^-[sSIikLfv]*o$/
const CURL_LONG = new Set(['--silent', '--show-error', '--head', '--insecure', '--location', '--fail', '--verbose', '--include', '--compressed'])
const CURL_LONG_THEN_VALUE = new Set(['--max-time', '--connect-timeout', '--write-out'])

// Only options known to leave it a plain request count: curl has too many
// spellings of "send this" to list them the other way round.
function isReadCurl(segment: string): boolean {
  const args = segment.split(/\s+/).slice(1)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('-')) continue
    if (CURL_FLAGS.test(arg) || CURL_LONG.has(arg)) continue
    if (CURL_FLAGS_THEN_VALUE.test(arg) || CURL_LONG_THEN_VALUE.has(arg)) {
      i++
      continue
    }
    if ((CURL_FLAGS_THEN_OUTPUT.test(arg) || arg === '--output') && args[i + 1] === '/dev/null') {
      i++
      continue
    }
    return false
  }
  return true
}

// Stands where an `ssh <host>` was: what follows it is the remote command.
const SSH = '\u0001'
// Stands where ssh does something other than run a command.
const NOT_A_READ = '\u0002'

const SSH_WRAPPER = /\bssh((?:\s+-[46AaCfGgKkMNnqsTtVvXxYy]+|\s+-[BbcDEeFIiJLlmOoPpQRSWw]\s*\S+)*)\s+[^\s-]\S*/g
// Tunnels, background and control connections hold no command to judge.
const SSH_NOT_A_COMMAND = /\s-[a-zA-Z0-9]*[fNMLRDwWO]/

function stripPrefixes(segment: string): string {
  let s = segment.trim()
  for (;;) {
    const next = s
      .replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, '')
      .replace(/^sudo\s+/, '')
      .replace(/^rtk\s+proxy\s+/, '')
      .replace(/^rtk\s+/, '')
    if (next === s) return s
    s = next
  }
}

function isReadSegment(raw: string): boolean {
  let segment = stripPrefixes(raw)
  if (segment.includes(NOT_A_READ)) return false
  if (segment.startsWith(SSH)) {
    segment = stripPrefixes(segment.replace(new RegExp(`^(?:${SSH}\\s*)+`), ''))
    // With no remote command, ssh runs whatever reaches its input.
    if (segment === '') return false
  }
  if (segment === '') return true
  const word = segment.split(/\s+/)[0]!
  return READ_WORDS.has(word) || (READ_RULES[word]?.(segment) ?? false)
}

export function isReadOnly(command: string): boolean {
  // These ssh options run a local command of their own.
  if (/\b(?:ProxyCommand|LocalCommand|KnownHostsCommand)\b/i.test(command)) return false
  const unwrapped = command
    .replace(SSH_WRAPPER, (_all, options: string) => ` ${SSH_NOT_A_COMMAND.test(options) ? NOT_A_READ : SSH} `)
    // Output thrown away changes nothing.
    .replace(/\d?&?>{1,2}\s*\/dev\/null/g, ' ')
    .replace(/\d>&\d/g, ' ')
  // A redirection, an input fed in or a substitution can do anything.
  if (/[<>`]|\$\(/.test(unwrapped)) return false
  return unwrapped.replace(/['"]/g, '').split(SEPARATORS).every(isReadSegment)
}

export function assess(command: string, t: Targets, currentContext: string | null): Assessment | null {
  const target = findTarget(command, t, currentContext)
  return target === null ? null : { target, isWrite: !isReadOnly(command) }
}
