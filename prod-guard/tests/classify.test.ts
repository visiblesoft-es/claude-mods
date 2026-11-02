import { expect, test } from 'claude-code/testing'

import { assess, isReadOnly, parseTargets } from '../hooks/lib/classify'

const T = parseTargets('203.0.113.10, db-prod, api.example.com', 'acme-production', 'deploy\\.sh')

test('finds production by host, alias, context and pattern', () => {
  for (const c of [
    'ssh root@203.0.113.10 uptime',
    'ssh -o ConnectTimeout=5 db-prod df -h',
    'scp f.txt db-prod:/tmp/',
    'curl -s https://api.example.com/health',
    'docker --context acme-production ps',
    'DOCKER_CONTEXT=acme-production docker ps',
    'docker context use acme-production',
    './deploy.sh production',
  ]) expect(assess(c, T, null)).not.toBeNull()
})

test('leaves alone what only looks like production', () => {
  for (const c of [
    'ssh root@1203.0.113.10 uptime',
    'cat notes-203.0.113.10.md.bak',
    'cd ~/Repositories/db-prod/ && git commit -m x',
    'git commit -m "db-prod"',
    'docker ps',
    'docker --context default ps',
    'dotnet test',
  ]) expect(assess(c, T, null)).toBeNull()
})

test('the docker context in use counts, unless the command names another', () => {
  expect(assess('docker compose up -d', T, 'acme-production')?.isWrite).toBe(true)
  expect(assess('docker ps', T, 'acme-production')?.isWrite).toBe(false)
  expect(assess('docker --context default rm x', T, 'acme-production')).toBeNull()
  expect(assess('ls', T, 'acme-production')).toBeNull()
})

test('reads stay reads', () => {
  for (const c of [
    "ssh -o ConnectTimeout=5 root@h 'docker ps --format x 2>/dev/null | grep api; df -h && uptime'",
    'ssh h docker logs --tail 50 api 2>&1 | tail -20',
    'ssh h docker compose -f a.yml logs web',
    'ssh -i ~/.ssh/k h journalctl -u nginx -n 50',
    'ssh h systemctl status nginx',
    'curl -sI https://h/health',
    'rtk proxy ssh h cat /etc/os-release',
    "ssh h sed -n 1,20p /etc/nginx/nginx.conf",
    'ssh h find /var/log -name "*.gz"',
  ]) expect(isReadOnly(c)).toBe(true)
})

test('anything else counts as a write', () => {
  for (const c of [
    "ssh h 'rm -rf /tmp/x'",
    'ssh h "cat a > b"',
    'ssh h docker compose up -d',
    'ssh h docker exec api ls',
    'ssh h docker rm -f api',
    'ssh h systemctl restart nginx',
    'ssh h bash -s < script.sh',
    'cat x | ssh h tee y',
    'ssh h sed -i s/a/b/ f',
    'ssh h find / -delete',
    'ssh h ls $(rm x)',
    'ssh h ls `rm x`',
    'ssh h git pull',
    'curl -X DELETE https://h/x',
    'curl -d a=b https://h/x',
    'scp f h:/tmp',
    'rsync -a d h:/d',
    'ssh h "for f in *; do rm $f; done"',
    './deploy.sh production',
    'ssh -o "ProxyCommand=sh -c x" h ls',
    'ssh h sudo reboot',
    'ssh h \\rm x',
  ]) expect(`${c}: ${isReadOnly(c)}`).toBe(`${c}: false`)
})

test('a pattern that does not compile is left out', () => {
  expect(parseTargets('', '', '(, ok').patterns.map(p => p.source)).toEqual(['ok'])
})
