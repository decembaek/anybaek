/** Worker 여러 곳에서 같이 쓰는 타입과 함수 */

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailBinding {
  send(message: {
    to: string | EmailAddress | Array<string | EmailAddress>;
    from: string | EmailAddress;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string | EmailAddress;
    bcc?: string | EmailAddress | Array<string | EmailAddress>;
  }): Promise<{ messageId: string }>;
}

export interface MailEnv {
  EMAIL: SendEmailBinding;
  /** 상담 요청을 받을 주소 */
  CONTACT_TO: string;
  /**
   * (선택) 실제로 메일을 받을 주소. 대시보드에서 Secret 으로 넣는다.
   * 무료 요금제는 계정에 인증된 받는 주소로만 보낼 수 있어서,
   * contact@anybaek.com 이 전달되는 개인 메일함 주소를 여기에 넣으면 된다.
   */
  CONTACT_INBOX?: string;
  /** 보내는 주소. Email Service 에 등록한 도메인의 주소여야 한다. */
  CONTACT_FROM: string;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
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

export function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
