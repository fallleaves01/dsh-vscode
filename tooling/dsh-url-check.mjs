#!/usr/bin/env node
// Replicates the EXACT validation + auth handshake of the DSH Sidebar extension
// (Lixxx1/dsh-vscode: src/runtime-target.ts, src/dsh-connection.ts).
// Usage:  node dsh-url-check.mjs 'http://127.0.0.1:3080/?token=XXXX'
// The token is never printed.

import { createHash, randomUUID } from 'node:crypto';

const raw = process.argv[2];
if (raw === undefined) {
  console.error("usage: node dsh-url-check.mjs 'http://127.0.0.1:3080/?token=XXXX'");
  process.exit(2);
}

const mask = (value) =>
  value.length <= 6 ? '******' : `${value.slice(0, 3)}…${value.slice(-2)} (len=${value.length})`;
const fails = [];
const pass = (label) => console.log(`  ok   ${label}`);
const fail = (label, detail) => {
  fails.push(label);
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};

// ---- 1. parse (extension: existingRuntimeUrl) ----
console.log('\n[1] URL 解析');
let url;
try {
  if (raw.length > 8192) throw new Error('长度超过 8192 字符');
  url = new URL(raw.trim());
  pass('可被解析为合法 URL，长度未超限');
} catch (e) {
  fail('URL 解析', e.message);
  console.log('\n>>> 插件会在这里直接拒绝，输入框不接受。');
  process.exit(1);
}

// ---- 2. dshLocalUrl strict rules (extension: dsh-connection.ts:21-34) ----
console.log('\n[2] 插件对地址的严格校验 (dshLocalUrl)');
if (url.protocol !== 'http:') fail('协议必须是 http:', `实际是 ${url.protocol}`); else pass('协议是 http:');

if (url.hostname === '127.0.0.1') pass('hostname 是 127.0.0.1');
else fail('hostname 必须严格等于 127.0.0.1', `实际是 "${url.hostname}"${url.hostname === 'localhost' ? ' ← localhost 不被接受！必须写 127.0.0.1' : ''}`);

if (url.username === '' && url.password === '') pass('无内嵌用户名/密码'); else fail('不能内嵌用户名或密码');
if (url.pathname === '/') pass('pathname 是 /'); else fail('pathname 必须是 /', `实际是 "${url.pathname}"`);
if (url.hash === '') pass('无 #fragment'); else fail('不能带 #fragment', url.hash);
if (url.port !== '0') pass(`端口是 ${url.port || '(默认80)'}`); else fail('端口不能是 0');

const keys = [...url.searchParams.keys()];
if (keys.some((k) => k !== 'token')) fail('查询参数只能有 token', `实际参数: ${JSON.stringify(keys)}`);
else pass('查询参数只有 token');

if (keys.length > 1) fail('查询参数不能多于一个', `实际 ${keys.length} 个: ${JSON.stringify(keys)}`);
else pass('查询参数数量为 1');

if (keys.length === 1) {
  const token = url.searchParams.get('token') ?? '';
  if (/^[A-Za-z0-9_-]+$/.test(token)) pass(`token 字符合法 ${mask(token)}`);
  else fail('token 只能含 A-Za-z0-9_-', '含非法字符（. = + / % 空格 等）；若为 URL 编码需先解码');
}

if (process.argv.includes('--show-token')) console.log(`  (token = ${url.searchParams.get('token')})`);

if (fails.length > 0) {
  console.log('\n>>> 结论：插件会在输入框里判定为无效，OK 按钮被禁用，按回车也「没反应」。');
  console.log('    输入框是 password 模式（内容显示为圆点），红色报错提示很容易被忽略。');
  process.exit(1);
}

// ---- 3. real auth handshake (extension: authenticate) ----
console.log('\n[3] 真实认证握手 (GET 期望 303 + location: /)');
let res;
try {
  res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
} catch (e) {
  fail('连接 127.0.0.1', e.message);
  console.log('\n>>> 连不上：确认 dsh web 还在跑。');
  process.exit(1);
}
console.log(`  HTTP ${res.status}  location=${res.headers.get('location') ?? '(none)'}`);
if (res.status === 303 && res.headers.get('location') === '/') pass('收到 303 重定向');
else if (res.status === 401 || res.status === 403) fail('token 被拒绝', `HTTP ${res.status} —— token 已过期（DSH 重启过就会这样），需重新取启动 URL`);
else fail('未按预期返回 303', `HTTP ${res.status}`);

const cookieName = `dsh-auth-${createHash('sha256').update(url.host).digest('base64url')}`;
const cookies = res.headers.getSetCookie().filter((c) => c.startsWith(`${cookieName}=`));
const cookie = cookies[0]?.split(';', 1)[0];
const cookieOk =
  cookies.length === 1 &&
  cookie !== undefined &&
  /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cookie.slice(cookieName.length + 1)) &&
  cookie.length <= 4096;
if (cookieOk) pass('拿到合法认证 cookie');
else fail('认证 cookie 不合法', `匹配到 ${cookies.length} 个名为 ${cookieName} 的 cookie`);

if (fails.length > 0) {
  console.log('\n>>> 结论：URL 格式没问题，但认证失败。最可能是 token 过期 —— 重启 dsh web 并复制新 URL。');
  process.exit(1);
}

// ---- 4. probe the Remote contract (extension: probeDshServer -> session/list) ----
console.log('\n[4] 探测 DSH Remote 契约 (POST /api/session/list)');
const rpcId = randomUUID();
const r = await fetch(new URL('/api/session/list', url.origin), {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    type: 'client-request',
    rpcId,
    method: 'session/list',
    payload: { args: { _request: {} } },
  }),
  signal: AbortSignal.timeout(10000),
});
console.log(`  HTTP ${r.status}`);
const env = await r.json().catch(() => undefined);
if (r.ok && env?.type === 'server-response' && env?.result?.ok === true && Array.isArray(env.result.value?.items)) {
  pass(`Remote 契约正常，可列出 ${env.result.value.items.length} 个已持久会话`);
  console.log('\n>>> 结论：这条 URL 完全可用。若插件仍没反应，问题不在 URL —— 去看 Output 面板。');
} else if (r.status === 404 || env?.result?.error?.code === 'gateway/not-found') {
  fail('该运行时不支持所需 Remote 契约', '需要 DeepSeek Harness >= 0.1.2-rc.1');
} else {
  fail('session/list 未返回预期结构', JSON.stringify(env)?.slice(0, 300));
}
console.log();
