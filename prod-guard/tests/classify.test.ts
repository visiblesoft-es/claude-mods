import { expect, test } from 'claude-code/testing'

import { assess, isReadOnly, parseTargets, withoutInertHeredocs } from '../hooks/lib/classify'

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

test('every docker command in a line counts, wherever it is', () => {
  const C = 'acme-production'
  expect(assess('docker --context dev ps && docker rm -f api', T, C)?.target).toBe(`docker:${C}`)
  expect(assess(`docker --context dev ps; docker --context ${C} rm -f api`, T, 'dev')?.target).toBe(`docker:${C}`)
  expect(assess('docker --context dev ps; docker --context dev rm x', T, C)).toBeNull()
  for (const c of ['bash -c "docker rm -f api"', "sh -c 'docker rm -f api'", '/usr/local/bin/docker rm -f api', 'rtk docker rm x']) {
    expect(assess(c, T, C)?.isWrite).toBe(true)
  }
})

test('text written to a local file only mentions production', () => {
  for (const c of [
    "cat > note.md <<'E'\nThe server is 203.0.113.10, see deploy.sh\nE",
    "cat >> note.md <<'E'\n203.0.113.10\nE",
    "cat <<'E' > note.md\n203.0.113.10\nE",
    "tee note.md <<'E'\n203.0.113.10\nE",
    "cd docs && cat > note.md <<E\n203.0.113.10\nE",
    "cat > test.ts <<'E'\nssh 203.0.113.10 reboot\nE\necho done",
  ]) expect(assess(c, T, null)).toBeNull()
})

test('a heredoc anything else may run counts', () => {
  for (const c of [
    // Any other program reading it.
    'bash <<E\n./deploy.sh\nE',
    'sudo sh -s <<E\nmysql -h 203.0.113.10 -e x\nE',
    'mysql <<E\nDROP TABLE deploy.sh\nE',
    "python3 - <<E\nhosts = '203.0.113.10'\nE\necho done",
    "node <<'E'\nconnect('203.0.113.10')\nE",
    "some-tool <<'E'\n203.0.113.10\nE",
    // Not written to a file.
    "cat <<'E'\n203.0.113.10\nE",
    "cat <<'E' | bash\n./deploy.sh\nE",
    "tee x <<'E' | bash\n./deploy.sh\nE",
    "cat > /dev/tcp/203.0.113.10/80 <<'E'\nx\nE",
    // An unquoted tag runs its substitutions; a quoted one does not.
    'cat > f <<E\n$(./deploy.sh)\nE',
    'cat > f <<E\n`./deploy.sh`\nE',
    // Written, then run.
    "cat > x.sh <<'E'\n./deploy.sh\nE\nbash x.sh",
    "cat > x.sh <<'E'\n./deploy.sh\nE\nchmod +x x.sh && ./x.sh",
  ]) expect(`${c}: ${assess(c, T, null)?.isWrite}`).toBe(`${c}: true`)
  // What stands outside the body still counts.
  expect(assess("cat > n <<'E'\nx\nE\nssh db-prod reboot", T, null)?.isWrite).toBe(true)
  expect(assess("ssh db-prod bash <<'E'\nreboot\nE", T, null)?.isWrite).toBe(true)
  // An unterminated heredoc is left as it is.
  expect(withoutInertHeredocs('cat > f <<E\n203.0.113.10')).toBe('cat > f <<E\n203.0.113.10')
  expect(withoutInertHeredocs("cat > f <<'E'\n203.0.113.10\nE")).toBe("cat > f <<E\nE")
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
    'rtk ssh h uptime',
    'rtk docker ps && rtk curl -s https://h',
    'ssh h date',
    'ssh h date +%F',
    'ssh h hostname -f',
    'ssh h tail -f /var/log/x',
    'ssh h journalctl -f -u nginx',
    'ssh h "sort a | uniq -c"',
    'curl -s -o /dev/null -w %{http_code} --max-time 5 https://h/health',
    'curl -so /dev/null https://h/health',
    'FOO=1 ssh -o ConnectTimeout=5 h uptime',
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
    // No remote command: ssh runs what reaches its input.
    'ssh h',
    'cat deploy.sh | ssh h',
    'echo "rm -rf /" | ssh h',
    'printf "reboot\\n" | ssh 203.0.113.10',
    // Tunnels and background connections.
    'ssh -R 80:localhost:80 h',
    'ssh -fN h',
    // curl's many ways of sending.
    'curl -XDELETE https://h/x',
    'curl -sX POST https://h/x',
    'curl -sd a=b https://h/x',
    'curl -so f https://h/x',
    'curl -o f https://h/x',
    'curl --json {} https://h/x',
    'curl --data-binary @f https://h/x',
    'curl -H "X-HTTP-Method-Override: DELETE" https://h/x',
    // Words that read only with the right arguments.
    'ssh h hostname evil',
    'ssh h date -s 2020-01-01',
    'ssh h journalctl --vacuum-time=1s',
    'ssh h uniq a b',
    'ssh h sed -n 1p -i f',
    'ssh h sort -uo f g',
    'ssh h git diff --output=/etc/x',
    'ssh h rg --pre /tmp/x foo',
    'ssh h ss -K dst 1.2.3.4',
    'ssh h file -C -m x',
    // rtk changes nothing about what runs.
    'rtk ssh h rm x',
    'rtk docker rm -f api',
    'rtk curl -XDELETE https://h/x',
  ]) expect(`${c}: ${isReadOnly(c)}`).toBe(`${c}: false`)
})

test('a pattern that does not compile is left out', () => {
  const t = parseTargets('', '', '(, ok')
  expect(t.patterns.map(p => p.source)).toEqual(['ok'])
  expect(t.invalid).toEqual(['('])
})

test('a pattern may hold a comma', () => {
  const t = parseTargets('', '', 'deploy\\d{1,3} other\\.sh')
  expect(t.patterns.map(p => p.source)).toEqual(['deploy\\d{1,3}', 'other\\.sh'])
  expect(assess('./deploy12 now', t, null)).not.toBeNull()
})
