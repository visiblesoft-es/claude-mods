// Pure logic: nothing here talks to the engine.
//
// Deciding what a shell command does cannot be exact, so this fails closed: a
// command that touches production counts as a write unless every part of it is
// on the read-only list below. Reading a script's contents is out of reach; a
// script that reaches production by itself is caught only through `patterns`.

export type Targets = { hosts: string[]; contexts: string[]; patterns: RegExp[] }

export type Assessment = { target: string; isWrite: boolean }

export function parseList(value: unknown): string[] {
  return typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : []
}

export function parseTargets(hosts: unknown, contexts: unknown, patterns: unknown): Targets {
  const compiled: RegExp[] = []
  for (const source of parseList(patterns)) {
    try {
      compiled.push(new RegExp(source))
    } catch {
      // A pattern that does not compile guards nothing; /prod-guard lists what does.
    }
  }
  return { hosts: parseList(hosts), contexts: parseList(contexts), patterns: compiled }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const DOCKER = /(?:^|[\s;&|(])docker(?:-compose)?\s/

export function mentionsDocker(command: string): boolean {
  return DOCKER.test(command)
}

function explicitContext(command: string): string | null {
  const m =
    /(?:--context[=\s]+|\bdocker\s+-c\s+|DOCKER_CONTEXT=|docker\s+context\s+use\s+)["']?([\w.-]+)/.exec(command)
  return m ? m[1]! : null
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
  const explicit = explicitContext(command)
  if (explicit !== null && t.contexts.includes(explicit)) return `docker:${explicit}`
  // The context in use reaches any docker command that names no other.
  if (explicit === null && currentContext !== null && mentionsDocker(command) && t.contexts.includes(currentContext)) {
    return `docker:${currentContext}`
  }
  for (const p of t.patterns) if (p.test(command)) return p.source
  return null
}

const READ_WORDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ps', 'df', 'du', 'free', 'uptime', 'whoami',
  'hostname', 'id', 'date', 'stat', 'wc', 'uniq', 'cut', 'tr', 'echo', 'printf', 'pwd', 'which', 'uname', 'cd',
  'true', 'file', 'ss', 'netstat', 'lsof', 'nproc', 'ping', 'journalctl',
])

const DOCKER_GLOBAL = /^(?:docker)(?:\s+(?:--context[=\s]\S+|-c\s+\S+|-H\s+\S+|--host[=\s]\S+))*/
const DOCKER_READ =
  /^\s+(?:ps|logs|inspect|images|stats|top|port|version|info|history|diff|(?:container|image|service|stack|network|volume|node|system|context)\s+(?:ls|ps|logs|inspect|df|show)|compose(?:\s+(?:-f\s+\S+|--file[=\s]\S+|-p\s+\S+|--project-name[=\s]\S+|--env-file[=\s]\S+))*\s+(?:ps|logs|config|top|images|ls))(?:\s|$)/

function isReadSegment(raw: string): boolean {
  const segment = raw
    .trim()
    .replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, '')
    .replace(/^sudo\s+/, '')
  if (segment === '') return true
  const word = segment.split(/\s+/)[0]!
  if (READ_WORDS.has(word)) return true
  if (word === 'sort') return !/\s(?:-o|--output)\b/.test(segment)
  if (word === 'sed') return /^sed\s+-n\s+\d+(?:,\d+)?p(?:\s|$)/.test(segment)
  if (word === 'find') return !/\s-(?:exec|execdir|ok|okdir|delete|fprint\w*|fls)\b/.test(segment)
  if (word === 'curl') return !/\s(?:-X|--request|-d|--data[\w-]*|-T|--upload-file|-F|--form|-o|--output|-O|--remote-name)\b/.test(segment)
  if (word === 'systemctl') return /^systemctl\s+(?:status|is-active|is-enabled|list-units|list-timers|show)\b/.test(segment)
  if (word === 'git') return /^git\s+(?:status|log|diff|show|rev-parse|remote\s+-v)(?:\s|$)/.test(segment)
  if (word === 'docker') {
    const rest = segment.replace(DOCKER_GLOBAL, '')
    return DOCKER_READ.test(rest)
  }
  return false
}

const SSH_WRAPPER = /\bssh(?:\s+-[46AaCfGgKkMNnqsTtVvXxYy]+|\s+-[BbcDEeFIiJLlmOoPpQRSWw]\s*\S+)*\s+[^\s-]\S*/g

export function isReadOnly(command: string): boolean {
  // These ssh options run a local command of their own.
  if (/\b(?:ProxyCommand|LocalCommand|KnownHostsCommand)\b/i.test(command)) return false
  const unwrapped = command
    .replace(/\brtk\s+proxy\s+/g, '')
    .replace(SSH_WRAPPER, ' ; ')
    // Output thrown away changes nothing.
    .replace(/\d?&?>{1,2}\s*\/dev\/null/g, ' ')
    .replace(/\d>&\d/g, ' ')
  // A redirection, an input fed in or a substitution can do anything.
  if (/[<>`]|\$\(/.test(unwrapped)) return false
  return unwrapped
    .replace(/['"]/g, '')
    .split(/\|\||&&|[;|&\n]/)
    .every(isReadSegment)
}

export function assess(command: string, t: Targets, currentContext: string | null): Assessment | null {
  const target = findTarget(command, t, currentContext)
  return target === null ? null : { target, isWrite: !isReadOnly(command) }
}
