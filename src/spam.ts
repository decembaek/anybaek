/**
 * 상담 폼 스팸 차단
 *
 * 이메일 주소는 보내는 사람이 마음대로 바꿔 적을 수 있으므로, 바꾸기 어려운 것으로 막는다.
 *
 *   1. 차단 목록    관리자 페이지에서 넣은 IP 주소·문구와 맞으면 버린다.
 *   2. 같은 내용    7일 안에 같은 본문이 또 오면 버린다. (이메일만 바꿔 다시 보내는 경우)
 *   3. 연속 전송    같은 IP 가 1분에 2번 넘게 보내면 거절한다. (wrangler.jsonc 의 CONTACT_LIMITER)
 *   4. 하루 횟수    같은 IP 가 24시간에 DAILY_LIMIT 번 넘게 보내면 거절한다.
 *
 * 1·2 는 보낸 사람이 눈치채지 못하게 성공한 것처럼 답하고, 3·4 는 메일로 연락하라고 알려 준다.
 * 1·2·4 는 KV(SPAM)를 쓴다. KV 가 없거나 읽고 쓰다 실패하면 막지 않고 통과시킨다.
 */

import type { RateLimiter } from './shared';

export interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface SpamEnv {
  /** 차단 목록, 보낸 횟수, 본 적 있는 본문을 담는 KV. (wrangler.jsonc 의 kv_namespaces) */
  SPAM?: KVStore;
  /** 상담 폼 연속 전송 제한 (wrangler.jsonc 의 ratelimits) */
  CONTACT_LIMITER?: RateLimiter;
}

export interface Sender {
  /** 요청을 보낸 IP 주소. 알 수 없으면 빈 문자열 */
  ip: string;
  /** 횟수를 세고 차단할 때 쓰는 값. IPv4 는 주소 그대로, IPv6 는 앞 64비트 */
  key: string;
  /** 나라 코드 (예: KR) */
  country: string;
}

export interface Block {
  kind: 'ip' | 'text';
  value: string;
  /** 차단한 날짜 (YYYY-MM-DD) */
  at: string;
}

export type Verdict =
  | { action: 'pass'; sentToday: number }
  /** 메일을 보내지 않고, 보낸 사람에게는 성공했다고 답한다. */
  | { action: 'drop'; reason: string }
  /** 메일을 보내지 않고, 보낸 사람에게 이유를 알려 준다. */
  | { action: 'reject'; reason: string; message: string };

interface Content {
  name: string;
  email: string;
  phone: string;
  message: string;
}

const DAILY_LIMIT = 3;
const DAY_SECONDS = 60 * 60 * 24;
const DUPLICATE_SECONDS = DAY_SECONDS * 7;
/** 이보다 짧은 본문("문의드립니다" 같은)은 서로 다른 사람이 똑같이 쓸 수 있어서 중복으로 보지 않는다. */
const DUPLICATE_MIN_LENGTH = 20;
const BLOCKS_KEY = 'blocks';
const MAX_BLOCKS = 500;
const MAX_TEXT_LENGTH = 200;

export function senderOf(request: Request): Sender {
  const ip = (request.headers.get('cf-connecting-ip') ?? '').trim();
  return { ip, key: ipKey(ip), country: request.headers.get('cf-ipcountry') ?? '' };
}

/**
 * IPv6 는 한 회선에 주소가 2^64개 주어져 계속 바꿔 쓸 수 있으므로 앞 64비트(회선)로 묶는다.
 * 이미 묶은 값을 다시 넣어도 같은 값이 나온다.
 */
export function ipKey(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/\/\d+$/, '');
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const gap = ip.includes('::') ? Math.max(0, 8 - left.length - right.length) : 0;
  const groups = [...left, ...Array<string>(gap).fill('0'), ...right];
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export async function screen(env: SpamEnv, sender: Sender, content: Content): Promise<Verdict> {
  const kv = env.SPAM;

  const blocks = await listBlocks(env);
  const haystack = normalize([content.name, content.email, content.phone, content.message].join('\n'));
  for (const block of blocks) {
    if (block.kind === 'ip' && sender.key && block.value === sender.key) return { action: 'drop', reason: 'blocked-ip' };
    if (block.kind === 'text' && haystack.includes(block.value)) return { action: 'drop', reason: 'blocked-text' };
  }

  const duplicate = await duplicateKey(content.message);
  if (kv && duplicate && (await read(kv, duplicate))) return { action: 'drop', reason: 'duplicate' };

  if (!sender.key) return { action: 'pass', sentToday: 0 };

  if (env.CONTACT_LIMITER) {
    const { success } = await env.CONTACT_LIMITER.limit({ key: `contact:${sender.key}` });
    if (!success) {
      return {
        action: 'reject',
        reason: 'too-fast',
        message: '방금 보내셨어요. 1분 뒤에 다시 보내거나 contact@anybaek.com으로 메일을 보내 주세요.',
      };
    }
  }

  const sentToday = kv ? Number(await read(kv, sentKey(sender))) || 0 : 0;
  if (sentToday >= DAILY_LIMIT) {
    return {
      action: 'reject',
      reason: 'daily-limit',
      message: '오늘은 이미 여러 번 보내셨어요. 더 전할 내용은 contact@anybaek.com으로 메일을 보내 주세요.',
    };
  }

  return { action: 'pass', sentToday };
}

/** 메일을 실제로 보낸 뒤에 부른다. 보낸 횟수와 본문을 기억해 둔다. */
export async function remember(env: SpamEnv, sender: Sender, content: Content, sentToday: number): Promise<void> {
  const kv = env.SPAM;
  if (!kv) return;
  const duplicate = await duplicateKey(content.message);
  const writes: Array<Promise<void>> = [];
  if (sender.key) writes.push(kv.put(sentKey(sender), String(sentToday + 1), { expirationTtl: DAY_SECONDS }));
  if (duplicate) writes.push(kv.put(duplicate, '1', { expirationTtl: DUPLICATE_SECONDS }));
  const results = await Promise.allSettled(writes);
  for (const result of results) {
    if (result.status === 'rejected') console.error('spam store write failed', String(result.reason));
  }
}

export async function listBlocks(env: SpamEnv): Promise<Block[]> {
  if (!env.SPAM) return [];
  try {
    const parsed: unknown = JSON.parse((await env.SPAM.get(BLOCKS_KEY)) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch (error) {
    console.error('spam store read failed', String(error));
    return [];
  }
}

export type BlockResult = { ok: true; blocks: Block[] } | { ok: false; message: string };

export async function addBlock(env: SpamEnv, kind: string, rawValue: string): Promise<BlockResult> {
  if (!env.SPAM) return { ok: false, message: NO_STORE };

  let value: string;
  if (kind === 'ip') {
    const ip = rawValue.trim().toLowerCase().replace(/\/\d+$/, '');
    const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
    const isV6 = /^[0-9a-f:]+$/.test(ip) && ip.split(':').length > 2;
    if (!isV4 && !isV6) return { ok: false, message: 'IP 주소를 확인해 주세요. 상담 요청 메일의 "보낸 곳"에 적힌 값을 넣으면 돼요.' };
    value = ipKey(ip);
  } else if (kind === 'text') {
    value = normalize(rawValue);
    if (value.length < 2) return { ok: false, message: '문구는 두 글자 이상 적어 주세요.' };
    if (value.length > MAX_TEXT_LENGTH) return { ok: false, message: '문구가 너무 길어요.' };
  } else {
    return { ok: false, message: '차단할 종류를 골라 주세요.' };
  }

  const blocks = await listBlocks(env);
  if (blocks.some((block) => block.kind === kind && block.value === value)) return { ok: true, blocks };
  if (blocks.length >= MAX_BLOCKS) return { ok: false, message: '차단 목록이 가득 찼어요. 안 쓰는 항목을 지워 주세요.' };

  const next: Block[] = [{ kind, value, at: new Date().toISOString().slice(0, 10) }, ...blocks];
  await env.SPAM.put(BLOCKS_KEY, JSON.stringify(next));
  return { ok: true, blocks: next };
}

export async function removeBlock(env: SpamEnv, kind: string, value: string): Promise<BlockResult> {
  if (!env.SPAM) return { ok: false, message: NO_STORE };
  const blocks = await listBlocks(env);
  const next = blocks.filter((block) => !(block.kind === kind && block.value === value));
  if (next.length !== blocks.length) await env.SPAM.put(BLOCKS_KEY, JSON.stringify(next));
  return { ok: true, blocks: next };
}

const NO_STORE = '차단 목록 저장소(SPAM)가 연결되지 않았어요. 다시 배포하면 만들어져요.';

function sentKey(sender: Sender): string {
  return `sent:${sender.key}`;
}

/** 대소문자, 전각·반각, 띄어쓰기 차이를 없앤다. */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 글자와 숫자만 남긴 본문의 해시. 띄어쓰기나 문장부호만 바꾼 것도 같은 내용으로 본다. */
async function duplicateKey(message: string): Promise<string | null> {
  const letters = normalize(message).replace(/[^\p{L}\p{N}]+/gu, '');
  if (letters.length < DUPLICATE_MIN_LENGTH) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(letters));
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `seen:${hex}`;
}

async function read(kv: KVStore, key: string): Promise<string | null> {
  try {
    return await kv.get(key);
  } catch (error) {
    console.error('spam store read failed', String(error));
    return null;
  }
}
