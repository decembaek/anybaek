/**
 * 관리자 페이지(public/admin/) API
 *
 *   POST /api/admin/login    { password }  →  로그인 쿠키를 준다.
 *   POST /api/admin/logout                 →  쿠키를 지운다.
 *   GET  /api/admin/session                →  로그인 상태와 보내는 주소를 알려 준다.
 *   POST /api/admin/send     { to, name, subject, message, copy }  →  고객에게 메일을 보낸다.
 *
 * 비밀번호는 대시보드 Secret ADMIN_PASSWORD 에 넣는다. (로컬은 .dev.vars)
 * 로그인 쿠키는 ADMIN_PASSWORD 로 서명하므로, 비밀번호를 바꾸면 기존 로그인은 모두 풀린다.
 */

import { EMAIL_PATTERN, escapeHtml, json, sameHost, type MailEnv } from './shared';

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AdminEnv extends MailEnv {
  /** 관리자 비밀번호. Secret 으로 넣는다. 없으면 관리자 기능이 꺼진다. */
  ADMIN_PASSWORD?: string;
  /** 고객에게 보낼 때 쓰는 보내는 주소. Email Service 에 등록한 도메인의 주소여야 한다. */
  ADMIN_FROM: string;
  /** 보내는 사람 이름 */
  ADMIN_FROM_NAME: string;
  /** 로그인 시도 횟수 제한 (wrangler.jsonc 의 ratelimits) */
  LOGIN_LIMITER?: RateLimiter;
}

const COOKIE = 'ab_admin';
const SESSION_SECONDS = 60 * 60 * 12;
const LIMITS = { to: 200, name: 80, subject: 200, message: 20000 } as const;

export async function handleAdmin(request: Request, env: AdminEnv, url: URL): Promise<Response> {
  const route = `${request.method} ${url.pathname}`;

  if (!env.ADMIN_PASSWORD) {
    return json({ ok: false, message: '관리자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았어요.' }, 503);
  }

  // 상태를 바꾸는 요청은 이 사이트에서 보낸 JSON 만 받는다. (CSRF 방지)
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
    if (!origin || !sameHost(origin, url.host) || !isJson) {
      return json({ ok: false, message: '이 사이트에서 보낸 요청만 받아요.' }, 403);
    }
  }

  switch (route) {
    case 'POST /api/admin/login':
      return login(request, env, url);
    case 'POST /api/admin/logout':
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0, url) });
    case 'GET /api/admin/session': {
      const signedIn = await isSignedIn(request, env);
      return json({ ok: true, signedIn, from: signedIn ? fromLabel(env) : undefined });
    }
    case 'POST /api/admin/send':
      if (!(await isSignedIn(request, env))) return json({ ok: false, message: '다시 로그인해 주세요.' }, 401);
      return send(request, env);
    default:
      return json({ ok: false, message: '없는 주소예요.' }, 404);
  }
}

async function login(request: Request, env: AdminEnv, url: URL): Promise<Response> {
  if (env.LOGIN_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${ip}` });
    if (!success) return json({ ok: false, message: '시도가 너무 많아요. 1분 뒤에 다시 해 주세요.' }, 429);
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return json({ ok: false, message: '보낸 내용을 읽지 못했어요.' }, 400);
  }

  if (!(await samePassword(password, env.ADMIN_PASSWORD!))) {
    return json({ ok: false, message: '비밀번호가 맞지 않아요.' }, 401);
  }

  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = `${expires}.${await sign(String(expires), env.ADMIN_PASSWORD!)}`;
  return json({ ok: true, from: fromLabel(env) }, 200, { 'set-cookie': cookie(token, SESSION_SECONDS, url) });
}

async function send(request: Request, env: AdminEnv): Promise<Response> {
  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, message: '보낸 내용을 읽지 못했어요.' }, 400);
  }
  const pick = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');
  const input = { to: pick('to'), name: pick('name'), subject: pick('subject'), message: pick('message') };
  const copy = raw.copy !== false;

  if (!EMAIL_PATTERN.test(input.to)) return json({ ok: false, message: '받는 사람 이메일 주소를 확인해 주세요.' }, 422);
  if (!input.subject) return json({ ok: false, message: '제목을 적어 주세요.' }, 422);
  if (!input.message) return json({ ok: false, message: '본문을 적어 주세요.' }, 422);
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    if (input[key].length > LIMITS[key]) return json({ ok: false, message: '내용이 너무 길어요.' }, 422);
  }
  if (/[\r\n]/.test(input.to + input.name + input.subject)) {
    return json({ ok: false, message: '받는 사람·제목에는 줄바꿈을 넣을 수 없어요.' }, 422);
  }

  const inbox = env.CONTACT_INBOX || env.CONTACT_TO;
  try {
    const { messageId } = await env.EMAIL.send({
      to: input.name ? { email: input.to, name: input.name } : input.to,
      from: { email: env.ADMIN_FROM, name: env.ADMIN_FROM_NAME },
      // 고객이 답장하면 contact@anybaek.com 으로 온다.
      replyTo: { email: env.CONTACT_TO, name: env.ADMIN_FROM_NAME },
      // 보낸 기록을 내 메일함에 남긴다.
      bcc: copy && inbox.toLowerCase() !== input.to.toLowerCase() ? inbox : undefined,
      subject: input.subject,
      text: input.message,
      html: `<div style="font-family:sans-serif;color:#17191f;font-size:16px;line-height:1.7;white-space:pre-wrap">${escapeHtml(input.message)}</div>`,
    });
    return json({ ok: true, message: `${input.to}에 보냈어요.`, messageId });
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'UNKNOWN';
    console.error('admin email failed', code, (error as Error).message);
    return json({ ok: false, message: `보내지 못했어요. (${code})`, code }, 502);
  }
}

function fromLabel(env: AdminEnv): string {
  return `${env.ADMIN_FROM_NAME} <${env.ADMIN_FROM}>`;
}

function cookie(value: string, maxAge: number, url: URL): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function isSignedIn(request: Request, env: AdminEnv): Promise<boolean> {
  const match = (request.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [expires, signature] = match[1].split('.');
  if (!expires || !signature || Number(expires) < Date.now() / 1000) return false;
  return equal(signature, await sign(expires, env.ADMIN_PASSWORD!));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`anybaek-admin:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 길이와 내용을 드러내지 않도록 해시끼리 비교한다. */
async function samePassword(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all(
    [given, expected].map((v) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))),
  );
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

function equal(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
