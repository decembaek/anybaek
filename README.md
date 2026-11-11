# AnyBaek 랜딩 페이지

anybaek.com 랜딩 페이지입니다. Cloudflare Workers에 배포합니다.
정적 파일(`public/`)은 Cloudflare가 직접 내보내고, 상담 요청 폼(`/api/contact`)만 Worker(`src/worker.ts`)가 받아 Cloudflare Email Service로 `contact@anybaek.com`에 보냅니다.

## 폴더

```
public/
  index.html          페이지 본문, 메타 태그, 구조화 데이터(JSON-LD)
  styles.css          스타일 (디자인 시스템 토큰은 맨 위 :root)
  main.js             상담 요청 폼 전송
  404.html            없는 주소일 때
  fonts/              Wanted Sans (글자 묶음별로 나뉜 woff2, OFL 라이선스)
  og.png              공유 이미지 (1200×630)
  favicon.svg, apple-touch-icon.png
  robots.txt          검색·AI 크롤러 허용
  sitemap.xml
  llms.txt            AI 검색 엔진용 요약
  _headers            보안 헤더, 폰트 캐시
src/worker.ts         POST /api/contact
wrangler.jsonc        배포 설정
```

## 로컬에서 보기

```bash
npm install
npm run dev        # http://localhost:8787
```

로컬에서는 메일이 실제로 나가지 않습니다. 폼을 보내면 터미널에 보낸 사람·받는 사람·제목이 찍히고, 본문은 `.wrangler/tmp/email/` 아래 파일로 저장됩니다.

## 배포

```bash
npx wrangler login
npm run deploy
```

처음 배포하면 `anybaek.<계정>.workers.dev` 주소로 올라갑니다. 여기서 페이지와 폼을 확인한 뒤 도메인을 연결하세요.

### 1. 메일 보내기 설정 (Cloudflare Email Service)

폼이 실제로 메일을 보내려면 대시보드에서 한 번 설정해야 합니다.

1. anybaek.com이 Cloudflare DNS를 쓰고 있어야 합니다.
2. Cloudflare 대시보드 → Compute → Email Service → Email Sending → **Onboard Domain**에서 anybaek.com을 등록합니다. SPF, DKIM, DMARC 레코드가 자동으로 추가됩니다.
3. 받는 주소 `contact@anybaek.com`이 실제로 메일을 받을 수 있어야 합니다. Email Routing으로 개인 메일함에 전달하도록 해 두었다면 그 설정이 켜져 있는지 확인하세요.
4. 보내는 주소는 `noreply@anybaek.com`입니다. 바꾸려면 `wrangler.jsonc`의 `CONTACT_FROM`을 고칩니다. 등록한 도메인의 주소여야 합니다.

요금제 참고: Cloudflare 문서에 따르면 계정에 인증된 받는 주소로 보내는 것은 무료 요금제에서도 되고, 임의의 주소로 보내려면 Workers Paid가 필요합니다. 배포 후 폼을 한 번 보내 보고, 실패하면 `npx wrangler tail`로 오류 코드(`E_RECIPIENT_NOT_ALLOWED`, `E_SENDER_DOMAIN_NOT_AVAILABLE` 등)를 확인하세요.

### 2. 도메인 연결

`wrangler.jsonc` 맨 아래 `routes` 주석을 풀고 다시 `npm run deploy` 하면 anybaek.com과 www.anybaek.com이 이 Worker로 연결됩니다. **지금 anybaek.com에 올라가 있는 기존 사이트가 바뀌니** workers.dev 주소에서 확인을 마친 뒤에 하세요.

www는 대시보드 Rules → Redirect Rules에서 `www.anybaek.com` → `https://anybaek.com`으로 301 리다이렉트를 걸어 두는 것을 권합니다. (페이지의 canonical은 `https://anybaek.com/`입니다.)

## SEO

적용된 것:

- `<title>`, 설명, canonical, Open Graph·Twitter 카드, 공유 이미지
- 구조화 데이터(JSON-LD): Organization, WebSite, WebPage, 세 사업(Service), FAQPage
- 시맨틱 HTML: `h1` 하나, 섹션마다 `h2`, 본문 내용은 자바스크립트 없이도 HTML에 다 들어 있음
- `sitemap.xml`, `robots.txt`
- 글자 묶음별로 나뉜 웹폰트(필요한 글자 파일만 내려받음), 폰트 1년 캐시

배포 후 직접 해야 하는 것:

1. **Google Search Console**과 **네이버 서치어드바이저**에 anybaek.com을 등록하고 `https://anybaek.com/sitemap.xml`을 제출합니다. 소유 확인용 메타 태그를 받으면 `public/index.html`의 `<head>`에 넣습니다.
2. 구조화 데이터는 Google 리치 결과 테스트에서 한 번 확인하세요.
3. 내용을 고치면 `sitemap.xml`의 `lastmod`, `index.html` JSON-LD의 `dateModified`, `llms.txt`의 "최종 수정"을 같이 바꿉니다.
4. 자주 묻는 질문을 고칠 때는 화면의 글과 JSON-LD `FAQPage`의 글을 똑같이 맞춥니다.

## GEO (AI 검색 최적화)

ChatGPT, Claude, Perplexity, Google AI 같은 답변 엔진이 AnyBaek을 정확히 인용하도록 한 것:

- `llms.txt`: 사업, 직급, 자주 묻는 질문, 용어를 사실 문장으로 정리한 요약
- `robots.txt`에서 AI 크롤러(GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended 등)를 명시적으로 허용
- "AnyBaek은 무엇을 하나요?"처럼 질문과 답이 한 쌍으로 읽히는 FAQ와 `FAQPage` 구조화 데이터
- 각 사업을 "무엇인지 한 문장 → 하는 일 → 상태" 순서로 서술

**꼭 확인할 것:** Cloudflare 대시보드의 AI 크롤러 차단 설정(Security → Bots의 "Block AI bots", AI Crawl Control)이 켜져 있으면 `robots.txt`에서 허용해도 AI 크롤러가 막힙니다. GEO를 원하면 anybaek.com에서 이 설정을 꺼 두세요.

## 스팸 방지

- 사람 눈에 안 보이는 칸(honeypot)을 채운 요청은 메일을 보내지 않습니다.
- 다른 사이트에서 보낸 요청(Origin 불일치)은 거절합니다.
- 스팸이 늘면 Cloudflare Turnstile을 폼에 추가하거나 대시보드에서 `/api/contact`에 Rate Limiting 규칙을 거세요.
