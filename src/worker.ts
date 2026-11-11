/**
 * AnyBaek 랜딩 페이지 Worker
 *
 * 정적 파일(public/)은 Cloudflare가 직접 내보내고,
 * 이 Worker는 /api/* 요청만 처리한다. (wrangler.jsonc 의 run_worker_first)
 *
 *   POST /api/contact  →  상담 요청을 Cloudflare Email Service 로 CONTACT_TO 에 보낸다.
 */

interface EmailAddress {
  email: string;
  name?: string;
}

interface SendEmailBinding {
  send(message: {
    to: string | EmailAddress;
    from: string | EmailAddress;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string | EmailAddress;
  }): Promise<{ messageId: string }>;
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  EMAIL: SendEmailBinding;
  /** 상담 요청을 받을 주소 */
  CONTACT_TO: string;
  /** 보내는 주소. Email Service 에 등록한 도메인의 주소여야 한다. */
  CONTACT_FROM: string;
}

interface ContactInput {
  name: string;
  email: string;
  phone: string;
  interest: string;
  message: string;
  /** 사람 눈에는 안 보이는 칸. 채워져 있으면 봇으로 본다. */
  website: string;
}

const LIMITS = { name: 80, email: 200, phone: 40, interest: 80, message: 4000 } as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, message: '없는 주소예요.' }, 404);
    }

    // /api/* 가 아닌 요청이 Worker 로 들어온 경우(정적 파일이 없을 때)
    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request: Request, env: Env, url: URL): Promise<Response> {
  const wantsJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const reply = (ok: boolean, message: string, status: number): Response =>
    wantsJson
      ? json({ ok, message }, status)
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

  const subject = `[AnyBaek 상담 요청] ${input.name}${input.interest ? ` · ${input.interest}` : ''}`;
  const rows: Array<[string, string]> = [
    ['이름', input.name],
    ['이메일', input.email],
    ['연락처', input.phone || '(적지 않음)'],
    ['관심 있는 사업', input.interest || '(고르지 않음)'],
    ['맡기고 싶은 일', input.message],
  ];

  try {
    await env.EMAIL.send({
      to: env.CONTACT_TO,
      from: { email: env.CONTACT_FROM, name: 'AnyBaek 상담 요청' },
      replyTo: { email: input.email, name: input.name },
      subject,
      text: rows.map(([label, value]) => `${label}\n${value}`).join('\n\n'),
      html: renderHtml(rows),
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'UNKNOWN';
    console.error('contact email failed', code, (error as Error).message);
    return reply(false, FALLBACK, 502);
  }

  return reply(true, '상담 요청을 보냈어요. 확인하는 대로 연락드릴게요.', 200);
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
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

function renderHtml(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 4px;color:#5a606b;font-size:14px">${escapeHtml(label)}</p>` +
        `<p style="margin:0 0 20px;font-size:16px;white-space:pre-wrap">${escapeHtml(value)}</p>`,
    )
    .join('');
  return `<div style="font-family:sans-serif;color:#17191f;line-height:1.6">${body}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}
