// 상담 요청 폼: /api/contact 로 보내고 결과를 폼 아래에 알려 준다.
(function () {
  var form = document.getElementById('contact-form');
  var status = document.getElementById('form-status');
  if (!form || !status) return;

  var button = form.querySelector('button[type="submit"]');
  var defaultLabel = button.textContent;
  var FALLBACK = '보내지 못했어요. 잠시 뒤에 다시 시도하거나 contact@anybaek.com으로 메일을 보내 주세요.';
  var NOT_HUMAN = '사람인지 확인하지 못했어요. 새로고침한 뒤 다시 보내 보시고, 계속 안 되면 contact@anybaek.com으로 메일을 보내 주세요.';

  function say(text, strong) {
    status.textContent = text;
    status.classList.toggle('is-strong', !!strong);
  }

  function busy(label) {
    button.disabled = !!label;
    button.textContent = label || defaultLabel;
  }

  // 자바스크립트 없이 보낸 뒤 돌아온 경우(?sent=1 / ?sent=0)
  var sent = new URLSearchParams(location.search).get('sent');
  if (sent === '1') say('상담 요청을 보냈어요. 확인하는 대로 연락드릴게요.', true);
  if (sent === '0') say(FALLBACK, true);

  var messages = {
    name: '이름을 적어 주세요.',
    email: '답장받을 이메일 주소를 확인해 주세요.',
    message: '맡기고 싶은 일을 적어 주세요.'
  };

  function firstInvalid() {
    var found = null;
    ['name', 'email', 'message'].forEach(function (key) {
      var el = form.elements[key];
      var bad = !el.value.trim() || (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()));
      el.setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad && !found) found = key;
    });
    return found;
  }

  // 사람 확인(Cloudflare Turnstile). 서버에 비밀 키가 설정되어 있을 때만 켜진다. 서버 쪽은 src/turnstile.ts
  // 사이트 키와 폼 이름(action)은 index.html 의 #human-check 에 data-sitekey, data-action 으로 적혀 있다.
  // 확인이 끝나면 Turnstile 이 폼 안에 cf-turnstile-response 라는 숨은 칸으로 토큰을 넣어 준다.
  var human = {
    siteKey: '',     // 비어 있으면 사람 확인을 쓰지 않는다.
    box: document.getElementById('human-check'),
    widget: null,    // turnstile.render 가 돌려준 위젯 id
    loading: false,
    token: '',
    failed: false,   // 스크립트를 못 불러왔거나 확인에 실패했다.
    waiting: null    // 확인이 끝나면 부를 함수(보내기)
  };

  function humanFailed() {
    human.token = '';
    human.failed = true;
    if (human.waiting) {
      human.waiting = null;
      busy('');
      say(NOT_HUMAN, true);
    }
  }

  function loadHumanCheck() {
    if (!human.siteKey || human.loading) return;
    human.loading = true;
    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onerror = humanFailed;
    script.onload = function () {
      if (!window.turnstile) return humanFailed();
      // 확인 칸이 실제로 나타났을 때만 자리를 차지하게 한다. (styles.css 의 .human-check)
      if ('ResizeObserver' in window) {
        new ResizeObserver(function () {
          human.box.classList.toggle('is-shown', human.box.offsetHeight > 0);
        }).observe(human.box);
      }
      human.widget = window.turnstile.render(human.box, {
        sitekey: human.siteKey,
        action: human.box.getAttribute('data-action') || undefined,
        language: 'ko',
        // 대부분은 화면에 아무것도 안 보이고, 직접 눌러야 할 때만 확인 칸이 나타난다.
        appearance: 'interaction-only',
        callback: function (token) {
          human.token = token;
          human.failed = false;
          if (human.waiting) {
            var go = human.waiting;
            human.waiting = null;
            go();
          }
        },
        'expired-callback': function () { human.token = ''; },
        'timeout-callback': humanFailed,
        'error-callback': function () { humanFailed(); return true; }
      });
    };
    document.head.appendChild(script);
  }

  // 한 번 쓴 토큰은 다시 못 쓰므로 보낸 뒤에는 새로 받는다.
  function renewHumanCheck() {
    human.token = '';
    if (human.widget !== null && window.turnstile) window.turnstile.reset(human.widget);
  }

  var ready = fetch('/api/contact/config', { headers: { 'Accept': 'application/json' } })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var siteKey = human.box && human.box.getAttribute('data-sitekey');
      if (!data.humanCheck || !siteKey) return;
      human.siteKey = siteKey;
      // 폼이 화면에 가까워지면 미리 확인을 시작해서, 보낼 때 기다리지 않게 한다.
      if (!('IntersectionObserver' in window)) return loadHumanCheck();
      var observer = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        observer.disconnect();
        loadHumanCheck();
      }, { rootMargin: '600px' });
      observer.observe(form);
    })
    .catch(function () {});

  function send() {
    var payload = {};
    new FormData(form).forEach(function (value, key) { payload[key] = String(value); });

    busy('보내는 중이에요');
    say('');

    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.ok) throw new Error(data.message || '');
          form.reset();
          say('상담 요청을 보냈어요. 확인하는 대로 연락드릴게요.', true);
        });
      })
      .catch(function (error) {
        say(error.message || FALLBACK, true);
      })
      .then(function () {
        busy('');
        renewHumanCheck();
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var invalid = firstInvalid();
    if (invalid) {
      say(messages[invalid], true);
      form.elements[invalid].focus();
      return;
    }

    busy('보내는 중이에요');
    say('');

    ready.then(function () {
      if (!human.siteKey || human.token) return send();

      // 아직 사람 확인이 끝나지 않았다. 끝나는 대로 보낸다.
      if (human.failed && human.widget === null) {
        busy('');
        return say(NOT_HUMAN, true);
      }
      human.waiting = send;
      busy('사람인지 확인하는 중이에요');
      say('확인 칸이 보이면 눌러 주세요. 확인이 끝나면 바로 보낼게요.');
      if (human.failed) {
        human.failed = false;
        renewHumanCheck();
      } else {
        loadHumanCheck();
      }
    });
  });
})();
