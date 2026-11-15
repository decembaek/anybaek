// 관리자 페이지: 로그인하고 고객에게 메일을 보낸다. API 는 src/admin.ts
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var views = ['loading', 'login-view', 'compose-view', 'error-view'];

  function show(id) {
    views.forEach(function (v) { $(v).hidden = v !== id; });
    $('logout').hidden = id !== 'compose-view';
  }

  function say(el, text, kind) {
    el.textContent = text || '';
    el.classList.toggle('is-strong', !!kind);
    el.classList.toggle('is-ok', kind === 'ok');
  }

  function api(method, path, body) {
    return fetch('/api/admin/' + path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'Accept': 'application/json' } : { 'Accept': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        data.status = res.status;
        return data;
      });
    });
  }

  // 상담 요청 메일의 "답장하기" 링크(#to=…&name=…&subject=…)로 들어오면 칸을 채운다.
  function prefill() {
    var params = new URLSearchParams(location.hash.slice(1));
    var to = params.get('to');
    if (!to) return;
    var name = params.get('name') || '';
    $('c-to').value = to;
    $('c-name').value = name;
    $('c-subject').value = params.get('subject') || '';
    if (!$('c-message').value) {
      $('c-message').value =
        '안녕하세요' + (name ? ', ' + name + '님' : '') + '.\nAnyBaek입니다. 상담 요청 주셔서 감사합니다.\n\n\n\n감사합니다.\nAnyBaek 드림';
    }
    // 주소창에 고객 정보가 남지 않게 지운다.
    history.replaceState(null, '', location.pathname);
  }

  function enterCompose(from) {
    $('from-label').textContent = from || '';
    show('compose-view');
    prefill();
    ($('c-to').value ? $('c-message') : $('c-to')).focus();
  }

  function enterLogin() {
    show('login-view');
    $('l-password').focus();
  }

  api('GET', 'session').then(function (data) {
    if (data.status === 503) {
      $('error-text').textContent = data.message;
      return show('error-view');
    }
    data.signedIn ? enterCompose(data.from) : enterLogin();
  }).catch(function () {
    $('error-text').textContent = '서버에 연결하지 못했어요. 새로고침해 주세요.';
    show('error-view');
  });

  $('login-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var status = $('login-status');
    var button = event.target.querySelector('button');
    var password = $('l-password').value;
    if (!password) return say(status, '비밀번호를 적어 주세요.', true);
    button.disabled = true;
    say(status, '');
    api('POST', 'login', { password: password }).then(function (data) {
      if (data.ok) {
        $('l-password').value = '';
        enterCompose(data.from);
      } else {
        say(status, data.message || '로그인하지 못했어요.', true);
      }
    }).catch(function () {
      say(status, '서버에 연결하지 못했어요.', true);
    }).then(function () { button.disabled = false; });
  });

  $('logout').addEventListener('click', function () {
    api('POST', 'logout', {}).then(enterLogin);
  });

  $('compose-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target;
    var status = $('compose-status');
    var button = form.querySelector('button[type="submit"]');
    var payload = {
      to: $('c-to').value.trim(),
      name: $('c-name').value.trim(),
      subject: $('c-subject').value.trim(),
      message: $('c-message').value,
      copy: $('c-copy').checked
    };

    var missing = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.to) ? ['c-to', '받는 사람 이메일 주소를 확인해 주세요.']
      : !payload.subject ? ['c-subject', '제목을 적어 주세요.']
      : !payload.message.trim() ? ['c-message', '본문을 적어 주세요.']
      : null;
    if (missing) {
      say(status, missing[1], true);
      return $(missing[0]).focus();
    }
    if (!confirm(payload.to + '에 메일을 보낼까요?')) return;

    button.disabled = true;
    button.textContent = '보내는 중이에요';
    say(status, '');

    api('POST', 'send', payload).then(function (data) {
      if (data.status === 401) {
        say($('login-status'), data.message, true);
        return enterLogin();
      }
      if (data.ok) {
        say(status, data.message, 'ok');
        form.reset();
        $('c-copy').checked = true;
      } else {
        say(status, data.message || '보내지 못했어요.', true);
      }
    }).catch(function () {
      say(status, '서버에 연결하지 못했어요. 보낸 내용은 그대로 남아 있어요.', true);
    }).then(function () {
      button.disabled = false;
      button.textContent = '메일 보내기';
    });
  });
})();
