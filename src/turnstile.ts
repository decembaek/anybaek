/**
 * 사람 확인 (Cloudflare Turnstile)
 *
 * 상담 폼을 자동 프로그램이 보내지 못하게, 브라우저에서 Turnstile 이 만든 토큰을 같이 받아
 * Cloudflare(siteverify)에 진짜인지 물어본다. 토큰은 한 번만 쓸 수 있고 5분 뒤에 만료된다.
 *
 *   사이트 키   공개해도 되는 값. public/index.html 의 #human-check 에 data-sitekey 로 적혀 있다.
 *   비밀 키     TURNSTILE_SECRET_KEY. 반드시 Secret 으로 넣는다. 이 값이 있으면 사람 확인이 켜진다.
 *   호스트      TURNSTILE_HOSTNAMES. 토큰이 만들어진 곳으로 인정할 호스트 이름. (wrangler.jsonc 의 vars)
 *
 * 켜져 있으면 다음을 모두 만족해야 통과한다. 하나라도 아니면, 확인 자체를 못 한 경우까지 포함해 거절한다.
 *   - siteverify 가 success: true 로 답한다.
 *   - 토큰의 action 이 이 폼의 것과 같다. (다른 위젯·다른 폼에서 받은 토큰을 가져다 쓰지 못하게)
 *   - 토큰의 hostname 이 TURNSTILE_HOSTNAMES 에 있다. (다른 사이트에서 받은 토큰을 가져다 쓰지 못하게)
 */

export interface TurnstileEnv {
  TURNSTILE_SECRET_KEY?: string;
  /** 쉼표로 구분한 호스트 이름. 예: "anybaek.com,www.anybaek.com". localhost 는 넣지 않는다. */
  TURNSTILE_HOSTNAMES?: string;
}

export type HumanCheck = { ok: true } | { ok: false; reason: string };

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 10_000;

/** 사람 확인이 켜져 있는지. 브라우저에도 알려 줘서, 켜져 있을 때만 위젯을 띄우게 한다. */
export function humanCheckOn(env: TurnstileEnv): boolean {
  return !!env.TURNSTILE_SECRET_KEY;
}

/**
 * @param action 이 폼의 이름. 브라우저에서 위젯을 띄울 때 넣은 값(data-action)과 같아야 한다.
 */
export async function checkHuman(env: TurnstileEnv, token: string, ip: string, action: string): Promise<HumanCheck> {
  if (!humanCheckOn(env)) return { ok: true };
  if (!token) return { ok: false, reason: 'missing-token' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'token-too-long' };

  const hostnames = (env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  if (hostnames.length === 0) {
    console.error('turnstile: TURNSTILE_HOSTNAMES is empty, rejecting');
    return { ok: false, reason: 'no-hostnames' };
  }

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
  if (ip) body.set('remoteip', ip);

  let status: number;
  let result: { success?: boolean; action?: string; hostname?: string; 'error-codes'?: string[] };
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      body,
    });
    status = response.status;
    // 거절할 때(400)도 이유가 본문에 담겨 오므로 상태와 상관없이 읽는다.
    result = await response.json();
  } catch (error) {
    console.error('turnstile: siteverify unavailable, rejecting', String(error));
    return { ok: false, reason: 'siteverify-unavailable' };
  }

  if (status !== 200 || result.success !== true) {
    const codes = Array.isArray(result['error-codes']) ? result['error-codes'].join(',') : '';
    // 비밀 키가 틀렸으면 모든 요청이 여기로 온다. 눈에 띄게 남긴다.
    if (codes.includes('input-secret')) console.error('turnstile: secret key rejected by siteverify', codes);
    return { ok: false, reason: codes || `siteverify-${status}` };
  }
  if (result.action !== action) return { ok: false, reason: `wrong-action:${String(result.action).slice(0, 40)}` };
  if (!hostnames.includes(String(result.hostname).toLowerCase())) {
    return { ok: false, reason: `wrong-hostname:${String(result.hostname).slice(0, 80)}` };
  }
  return { ok: true };
}
