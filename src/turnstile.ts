/**
 * 사람 확인 (Cloudflare Turnstile)
 *
 * 상담 폼을 자동 프로그램이 보내지 못하게, 브라우저에서 Turnstile 이 만든 토큰을 같이 받아
 * Cloudflare 에 진짜인지 물어본다. 토큰은 한 번만 쓸 수 있고 5분 뒤에 만료된다.
 *
 * 키 두 개가 모두 있을 때만 켜진다. 대시보드 → Turnstile 에서 위젯을 만들면 둘 다 나온다.
 *   TURNSTILE_SITE_KEY     사이트 키. 공개해도 되는 값. 브라우저에 내려 준다.
 *   TURNSTILE_SECRET_KEY   비밀 키. 반드시 Secret 으로 넣는다.
 *
 * 토큰이 없거나 가짜면 거절한다. Cloudflare 에 물어보지 못했거나 우리 쪽 키가 잘못된 경우에는
 * 고객의 상담 요청을 잃지 않도록 통과시키고 로그를 남긴다. (스팸은 src/spam.ts 가 한 번 더 거른다.)
 */

export interface TurnstileEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export type HumanCheck = { ok: true } | { ok: false; reason: string };

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
/** 보낸 사람 탓이 아니라 우리 설정이나 Cloudflare 쪽 문제일 때 오는 오류 코드 */
const NOT_THE_SENDER = ['missing-input-secret', 'invalid-input-secret', 'internal-error'];

/** 브라우저에 내려 줄 사이트 키. 사람 확인이 꺼져 있으면 null */
export function turnstileSiteKey(env: TurnstileEnv): string | null {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

export async function checkHuman(env: TurnstileEnv, token: string, ip: string): Promise<HumanCheck> {
  if (!turnstileSiteKey(env)) return { ok: true };
  if (!token) return { ok: false, reason: 'missing-token' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'token-too-long' };

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
  if (ip) body.set('remoteip', ip);

  let codes: string[];
  try {
    const response = await fetch(VERIFY_URL, { method: 'POST', body });
    const result = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (result.success === true) return { ok: true };
    codes = Array.isArray(result['error-codes']) ? result['error-codes'] : [];
  } catch (error) {
    console.error('turnstile unavailable, letting the request through', String(error));
    return { ok: true };
  }

  if (codes.some((code) => NOT_THE_SENDER.includes(code))) {
    console.error('turnstile misconfigured or failing, letting the request through', codes.join(','));
    return { ok: true };
  }
  return { ok: false, reason: codes.join(',') || 'rejected' };
}
