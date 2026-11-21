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
  admin/              관리자 페이지 (고객에게 메일 보내기, 스팸 차단)
src/worker.ts         POST /api/contact
src/admin.ts          /api/admin/* (로그인, 메일 보내기, 스팸 차단 목록)
src/spam.ts           상담 폼 스팸 차단
src/turnstile.ts      상담 폼 사람 확인 (Cloudflare Turnstile)
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

처음 배포하면 `anybaek-next-web.<계정>.workers.dev` 주소로 올라갑니다. 여기서 페이지와 폼을 확인한 뒤 도메인을 연결하세요.

### 1. 메일 보내기 설정 (Cloudflare Email Service)

폼이 실제로 메일을 보내려면 대시보드에서 한 번 설정해야 합니다.

1. anybaek.com이 Cloudflare DNS를 쓰고 있어야 합니다.
2. Cloudflare 대시보드 → Compute → Email Service → Email Sending → **Onboard Domain**에서 anybaek.com을 등록합니다. SPF, DKIM, DMARC 레코드가 자동으로 추가됩니다.
3. 받는 주소 `contact@anybaek.com`이 실제로 메일을 받을 수 있어야 합니다. Email Routing으로 개인 메일함에 전달하도록 해 두었다면 그 설정이 켜져 있는지 확인하세요.
4. 무료 요금제에서 `E_RECIPIENT_NOT_ALLOWED`로 실패하면, 대시보드 → Worker → Settings → Variables and Secrets에 `CONTACT_INBOX`라는 **Secret**을 만들고 `contact@anybaek.com`이 전달되는 실제 메일함 주소(Email Routing에 인증된 받는 주소)를 넣으세요. 이 값이 있으면 그 주소로 보냅니다.
5. 보내는 주소는 `noreply@anybaek.com`입니다. 바꾸려면 `wrangler.jsonc`의 `CONTACT_FROM`을 고칩니다. 등록한 도메인의 주소여야 합니다.

요금제 참고: Cloudflare 문서에 따르면 계정에 인증된 받는 주소로 보내는 것은 무료 요금제에서도 되고, 임의의 주소로 보내려면 Workers Paid가 필요합니다. 배포 후 폼을 한 번 보내 보고, 실패하면 응답의 `code` 값이나 `npx wrangler tail`로 오류 코드(`E_RECIPIENT_NOT_ALLOWED`, `E_SENDER_DOMAIN_NOT_AVAILABLE` 등)를 확인하세요.

### 2. 관리자 페이지 (고객에게 메일 보내기)

`/admin/`에서 로그인한 뒤 고객에게 `AnyBaek <contact@anybaek.com>` 이름으로 메일을 보낼 수 있습니다.

- 상담 요청 알림 메일 맨 아래 **관리자 페이지에서 답장하기** 버튼을 누르면 받는 사람·이름·제목이 채워진 채로 열립니다.
- 고객이 답장하면 `contact@anybaek.com`(Reply-To)으로 오고, Email Routing을 거쳐 개인 메일함에 들어옵니다.
- "내 메일함에 사본 받기"를 켜 두면 보낸 메일이 숨은참조로 `CONTACT_INBOX`(없으면 `CONTACT_TO`)에 남습니다.

설정:

1. 비밀번호를 Secret으로 넣습니다. 길고 추측하기 어려운 값으로 정하세요.
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   ```
   로컬에서는 `.dev.vars` 파일에 `ADMIN_PASSWORD=...` 한 줄을 적습니다. (git에 올라가지 않음)
2. 보내는 주소·이름은 `wrangler.jsonc`의 `ADMIN_FROM`, `ADMIN_FROM_NAME`입니다.
3. **임의의 고객 주소로 보내려면 Workers Paid 요금제가 필요합니다.** 무료 요금제에서는 계정에 인증된 주소로만 보내지므로 `E_RECIPIENT_NOT_ALLOWED`로 실패합니다.

보안: 로그인 쿠키는 12시간 유지되고 `ADMIN_PASSWORD`로 서명합니다. 비밀번호를 바꾸면 모든 로그인이 풀립니다. 로그인 시도는 IP당 1분에 5번으로 제한합니다. 더 단단하게 하려면 Cloudflare Zero Trust → Access에서 `anybaek.com/admin*`과 `anybaek.com/api/admin/*`에 본인 이메일만 통과하는 정책을 추가로 거세요. (50명까지 무료)

### 3. 도메인 연결

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

이메일 주소는 보내는 사람이 마음대로 바꿔 적을 수 있어서, 이메일이 아니라 보낸 곳(IP 주소)과 내용으로 막습니다. (`src/spam.ts`)

자동으로 막는 것:

- 사람 눈에 안 보이는 칸(honeypot)을 채운 요청은 메일을 보내지 않습니다.
- 다른 사이트에서 보낸 요청(Origin 불일치)은 거절합니다.
- **같은 내용 반복**: 7일 안에 같은 본문이 또 오면 메일을 보내지 않습니다. 이메일·이름을 바꾸거나 띄어쓰기·문장부호만 고쳐도 같은 내용으로 봅니다. (글자 수 20자 미만의 짧은 본문은 제외)
- **연속 전송**: 같은 IP가 1분에 2번 넘게 보내면 거절합니다.
- **하루 횟수**: 같은 IP가 24시간에 3번 넘게 보내면 거절합니다. (`src/spam.ts`의 `DAILY_LIMIT`)

직접 막는 것:

- 상담 요청 메일 맨 아래에 **보낸 곳**(IP 주소, 나라, 최근 24시간 동안 몇 번째인지)이 적혀 있습니다. 스팸이면 그 아래 **스팸이면 이 보낸 곳 차단하기**를 누르세요. 관리자 페이지의 차단 칸에 값이 채워진 채로 열리고, **차단하기**를 누르면 차단됩니다.
- 보낸 곳을 계속 바꾸는 경우에는 관리자 페이지에서 **문구**를 차단하세요. 내용·이름·이메일·연락처에 그 문구가 들어 있으면 메일을 보내지 않습니다. (예: 스팸에 늘 들어 있는 링크 주소나 전화번호)
- IPv6 주소는 한 회선이 주소를 계속 바꿔 쓸 수 있어서 앞 64비트(`…::/64`)로 묶어 차단하고 셉니다.

차단되었거나 같은 내용을 반복한 요청에는 보낸 것처럼 답합니다. 보낸 사람이 막힌 걸 알고 방법을 바꾸지 않게 하기 위해서입니다. 횟수 제한에 걸린 요청에는 contact@anybaek.com으로 메일을 보내 달라고 알려 줍니다. 무엇이 왜 막혔는지는 `npx wrangler tail`이나 대시보드 Workers Logs에서 `contact blocked`로 찾을 수 있습니다.

차단 목록과 횟수는 KV(`SPAM`)에 저장합니다. `wrangler.jsonc`에 id 없이 적어 두었으므로 `npm run deploy` 할 때 wrangler가 KV를 만들어 연결합니다. KV를 읽고 쓰지 못하면 막지 않고 메일을 보냅니다.

### 사람 확인 (Cloudflare Turnstile)

자동 프로그램이 IP와 내용을 매번 바꿔 가며 보내는 스팸은 위 방법으로 다 막을 수 없어서, 브라우저에서 사람이 보낸 것인지 Cloudflare Turnstile로 확인합니다. (`src/turnstile.ts`) **위젯의 비밀 키를 Secret으로 넣어야 켜집니다.** 넣기 전에는 사람 확인 없이 동작합니다.

설정값:

| 값 | 어디에 | 설명 |
| --- | --- | --- |
| 사이트 키 | `public/index.html`의 `#human-check`에 `data-sitekey` | 공개해도 되는 값. 위젯을 바꾸면 여기를 고칩니다. |
| 비밀 키 | Secret `TURNSTILE_SECRET_KEY` | 이 값이 있으면 사람 확인이 켜집니다. 저장소에 올리지 않습니다. |
| 호스트 이름 | `wrangler.jsonc`의 `TURNSTILE_HOSTNAMES` | 토큰이 만들어진 곳으로 인정할 주소. 쉼표로 구분하고 `localhost`는 넣지 않습니다. |
| 폼 이름 | `index.html`의 `data-action`, `src/worker.ts`의 `HUMAN_CHECK_ACTION` | 둘이 같아야 합니다. (`contact`) |

켜는 방법:

1. Cloudflare 대시보드 → Turnstile → 위젯 → Settings에서 **Secret Key**를 복사합니다. 위젯의 Hostname에 `anybaek.com`이 들어 있어야 합니다.
2. 대시보드 → Workers & Pages → anybaek-next-web → Settings → Variables and Secrets에서 `TURNSTILE_SECRET_KEY`라는 이름의 **Secret**으로 넣습니다. 터미널에서는 `npx wrangler secret put TURNSTILE_SECRET_KEY` 입니다. 비밀 키는 채팅이나 저장소에 붙여 넣지 않습니다.
3. 사이트에서 상담 요청을 한 번 보내 메일이 오는지 확인합니다.

끄려면 `TURNSTILE_SECRET_KEY`를 지웁니다.

동작:

- 폼이 화면에 가까워지면 확인을 미리 시작합니다. 대부분은 화면에 아무것도 보이지 않고, Cloudflare가 의심스럽다고 본 경우에만 버튼 위에 확인 칸이 나타납니다.
- 확인이 끝나기 전에 보내기를 누르면, 확인이 끝나는 대로 자동으로 보냅니다.
- 서버는 Cloudflare(siteverify)가 통과시켰고, 토큰의 폼 이름(action)이 `contact`이고, 토큰이 만들어진 주소(hostname)가 `TURNSTILE_HOSTNAMES`에 있을 때만 받습니다.
- **켜져 있는 동안에는 확인하지 못한 요청을 모두 거절합니다.** 토큰이 없거나 가짜인 경우뿐 아니라, Cloudflare에 물어보지 못했거나 비밀 키·호스트 이름 설정이 틀린 경우도 거절합니다. 거절된 사람에게는 contact@anybaek.com으로 메일을 보내 달라고 안내합니다. 그래서 비밀 키를 넣거나 바꾼 뒤에는 꼭 한 번 보내 보세요.
- 거절한 이유는 `npx wrangler tail`이나 Workers Logs에서 `contact blocked not-human:…`으로 찾습니다. (예: `invalid-input-secret`은 비밀 키가 틀림, `wrong-hostname:…`은 `TURNSTILE_HOSTNAMES`에 없는 주소에서 보냄)
- 사람 확인이 켜져 있으면 자바스크립트를 끈 브라우저에서는 폼을 보낼 수 없습니다. 메일로 보내 달라는 안내가 나옵니다.
- `public/_headers`의 Content-Security-Policy에서 `challenges.cloudflare.com`의 스크립트와 프레임을 허용했습니다.

로컬(`npm run dev`)에서는 `.dev.vars`에 `TURNSTILE_SECRET_KEY`가 없으므로 꺼져 있습니다. Cloudflare의 테스트용 키는 폼 이름과 주소를 돌려주지 않아서 서버 검사를 통과하지 못하므로, 켜진 상태는 배포된 사이트에서 확인합니다.
