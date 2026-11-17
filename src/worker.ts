/**
 * AnyBaek 랜딩 페이지 Worker
 *
 * 정적 파일(public/)은 Cloudflare가 직접 내보내고,
 * 이 Worker는 /api/* 요청만 처리한다. (wrangler.jsonc 의 run_worker_first)
 *
 *   POST /api/contact  →  상담 요청을 Cloudflare Email Service 로 CONTACT_TO 에 보낸다.
 *                         보내기 전에 사람이 보낸 것인지(src/turnstile.ts), 스팸인지(src/spam.ts) 본다.
 *   GET  /api/contact/config  →  폼이 쓸 설정(사람 확인용 사이트 키)을 준다.
 *   /api/admin/*       →  관리자 페이지(public/admin/)용 API. src/admin.ts
 */

import { handleAdmin, type AdminEnv } from './admin';
import { EMAIL_PATTERN, escapeHtml, json, sameHost } from './shared';
import { remember, screen, senderOf } from './spam';
import { checkHuman, turnstileSiteKey, type TurnstileEnv } from './turnstile';

interface Env extends AdminEnv, TurnstileEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ContactInput {
  name: string;
  email: string;
  phone: string;
  interest: string;
  message: string;
  /** 사람 눈에는 안 보이는 칸. 채워져 있으면 봇으로 본다. */
  website: string;
  /** Turnstile 이 브라우저에서 만들어 준 사람 확인 토큰 */
  humanToken: string;
}

const LIMITS = { name: 80, email: 200, phone: 40, interest: 80, message: 4000 } as const;
const FALLBACK = '보내지 못했어요. 잠시 뒤에 다시 시도하거나 contact@anybaek.com으로 메일을 보내 주세요.';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') {
        return json({ ok: false, message: 'POST 요청만 받아요.' }, 405, { Allow: 'POST' });
      }
      return handleContact(request, env, url);
    }

    if (url.pathname === '/api/contact/config') {
      return json({ ok: true, turnstileSiteKey: turnstileSiteKey(env) });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdmin(request, env, url);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, message: '없는 주소예요.' }, 404);
    }

    // /api/* 가 아닌 요청이 Worker 로 들어온 경우(정적 파일이 없을 때)
    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request: Request, env: Env, url: URL): Promise<Response> {
  const wantsJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const reply = (ok: boolean, message: string, status: number, code?: string): Response =>
    wantsJson
      ? json(code ? { ok, message, code } : { ok, message }, status)
      : Response.redirect(`${url.origin}/?sent=${ok ? 1 : 0}#contact`, 303);

  // 다른 사이트에서 보낸 요청은 받지 않는다.
  const origin = request.headers.get('origin');
  if (origin && !sameHost(origin, url.host)) {
    return reply(false, '이 사이트에서 보낸 요청만 받아요.', 403);
  }

  let input: ContactInput;
  try {
    input = await readInput(request, wantsJson);
  } catch {
    return reply(false, '보낸 내용을 읽지 못했어요. 다시 시도해 주세요.', 400);
  }

  // 봇이 숨은 칸을 채웠으면 성공한 것처럼 답하고 메일은 보내지 않는다.
  if (input.website) return reply(true, '상담 요청을 보냈어요.', 200);

  const problem = validate(input);
  if (problem) return reply(false, problem, 422);

  const sender = senderOf(request);

  // 자동 프로그램이 아니라 사람이 브라우저에서 보낸 것인지 확인한다.
  const human = await checkHuman(env, input.humanToken, sender.ip);
  if (!human.ok) {
    console.log('contact blocked', `not-human:${human.reason}`, sender.key || '(ip 없음)', sender.country);
    return reply(
      false,
      '사람인지 확인하지 못했어요. 다시 보내 보시고, 계속 안 되면 contact@anybaek.com으로 메일을 보내 주세요.',
      403,
      'HUMAN_CHECK',
    );
  }

  // 차단한 곳, 같은 내용 반복, 너무 잦은 전송을 걸러 낸다.
  const verdict = await screen(env, sender, input);
  if (verdict.action !== 'pass') {
    console.log('contact blocked', verdict.reason, sender.key || '(ip 없음)', sender.country);
    return verdict.action === 'drop'
      ? reply(true, '상담 요청을 보냈어요. 확인하는 대로 연락드릴게요.', 200)
      : reply(false, verdict.message, 429);
  }

  const subject = `[AnyBaek 상담 요청] ${input.name}${input.interest ? ` · ${input.interest}` : ''}`;
  const rows: Array<[string, string]> = [
    ['이름', input.name],
    ['이메일', input.email],
    ['연락처', input.phone || '(적지 않음)'],
    ['관심 있는 사업', input.interest || '(고르지 않음)'],
    ['맡기고 싶은 일', input.message],
    [
      '보낸 곳',
      `${sender.ip || '알 수 없음'}${sender.country ? ` (${sender.country})` : ''} · 최근 24시간 동안 ${verdict.sentToday + 1}번째`,
    ],
  ];

  // 관리자 페이지의 메일 쓰기 화면으로 바로 가는 링크. 값은 # 뒤에 두어 서버 로그에 남지 않게 한다.
  const replyUrl = `${url.origin}/admin/#${new URLSearchParams({
    to: input.email,
    name: input.name,
    subject: `Re: AnyBaek 상담 요청${input.interest ? ` · ${input.interest}` : ''}`,
  })}`;
  // 스팸일 때 누르는 링크. 관리자 페이지의 차단 칸에 보낸 곳이 채워진 채로 열린다.
  const blockUrl = sender.key ? `${url.origin}/admin/#${new URLSearchParams({ block: sender.key })}` : '';

  try {
    await env.EMAIL.send({
      to: env.CONTACT_INBOX || env.CONTACT_TO,
      from: { email: env.CONTACT_FROM, name: 'AnyBaek 상담 요청' },
      replyTo: { email: input.email, name: input.name },
      subject,
      text:
        rows.map(([label, value]) => `${label}\n${value}`).join('\n\n') +
        `\n\n답장하기: ${replyUrl}` +
        (blockUrl ? `\n스팸이면 이 보낸 곳 차단하기: ${blockUrl}` : ''),
      html: renderHtml(rows, replyUrl, blockUrl),
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'UNKNOWN';
    console.error('contact email failed', code, (error as Error).message);
    // 오류 코드를 응답에 같이 실어 보낸다. (원인 확인용. 예: E_SENDER_DOMAIN_NOT_AVAILABLE)
    return reply(false, FALLBACK, 502, code);
  }

  await remember(env, sender, input, verdict.sentToday);

  return reply(true, '상담 요청을 보냈어요. 확인하는 대로 연락드릴게요.', 200);
}

async function readInput(request: Request, isJson: boolean): Promise<ContactInput> {
  let raw: Record<string, unknown> = {};
  if (isJson) {
    raw = (await request.json()) as Record<string, unknown>;
  } else {
    (await request.formData()).forEach((value, key) => {
      raw[key] = value;
    });
  }
  const pick = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');
  return {
    name: pick('name'),
    email: pick('email'),
    phone: pick('phone'),
    interest: pick('interest'),
    message: pick('message'),
    website: pick('website'),
    humanToken: pick('cf-turnstile-response'),
  };
}

function validate(input: ContactInput): string | null {
  if (!input.name) return '이름을 적어 주세요.';
  if (!EMAIL_PATTERN.test(input.email)) return '답장받을 이메일 주소를 확인해 주세요.';
  if (!input.message) return '맡기고 싶은 일을 적어 주세요.';
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    if (input[key].length > LIMITS[key]) return '내용이 너무 길어요. 조금 줄여서 다시 보내 주세요.';
  }
  // 제목 줄에 들어가는 값에 줄바꿈이 있으면 메일 헤더를 조작하려는 시도로 본다.
  if (/[\r\n]/.test(input.name + input.email + input.interest)) return '입력한 내용을 다시 확인해 주세요.';
  return null;
}

function renderHtml(rows: Array<[string, string]>, replyUrl: string, blockUrl: string): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 4px;color:#5a606b;font-size:14px">${escapeHtml(label)}</p>` +
        `<p style="margin:0 0 20px;font-size:16px;white-space:pre-wrap">${escapeHtml(value)}</p>`,
    )
    .join('');
  const button =
    `<p style="margin:8px 0 0"><a href="${escapeHtml(replyUrl)}" ` +
    `style="display:inline-block;background:#17191f;color:#ffffff;padding:12px 20px;border-radius:12px;font-weight:700;text-decoration:none">관리자 페이지에서 답장하기</a></p>`;
  const block = blockUrl
    ? `<p style="margin:16px 0 0;font-size:14px"><a href="${escapeHtml(blockUrl)}" style="color:#5a606b">스팸이면 이 보낸 곳 차단하기</a></p>`
    : '';
  return `<div style="font-family:sans-serif;color:#17191f;line-height:1.6">${body}${button}${block}</div>`;
}
