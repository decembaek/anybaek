// 관리자 페이지: 로그인하고 고객에게 메일을 보내고, 상담 폼 스팸을 차단한다. API 는 src/admin.ts
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var views = ['loading', 'login-view', 'compose-view', 'error-view'];

  function show(id) {
    views.forEach(function (v) { $(v).hidden = v !== id; });
    $('logout').hidden = id !== 'compose-view';
    $('block-view').hidden = id !== 'compose-view';
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
  // "차단하기" 링크(#block=…)로 들어오면 차단 칸을 채우고 true 를 돌려준다. 차단은 버튼을 눌러야 된다.
  function prefill() {
    var params = new URLSearchParams(location.hash.slice(1));
    var block = params.get('block');
    if (block) {
      $('b-kind').value = 'ip';
      $('b-value').value = block;
      say($('block-status'), '상담 요청 메일에서 가져온 보낸 곳이에요. 차단하려면 아래 버튼을 눌러 주세요.', true);
      history.replaceState(null, '', location.pathname);
      return true;
    }
    var to = params.get('to');
    if (!to) return false;
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
    return false;
  }

  function enterCompose(from) {
    $('from-label').textContent = from || '';
    show('compose-view');
    loadBlocks();
    if (prefill()) {
      $('block-view').scrollIntoView();
      $('block-form').querySelector('button').focus();
    } else {
      ($('c-to').value ? $('c-message') : $('c-to')).focus();
    }
  }

  // 로그인이 풀렸으면 로그인 화면으로 보내고 true 를 돌려준다.
  function signedOut(data) {
    if (data.status !== 401) return false;
    say($('login-status'), data.message, true);
    enterLogin();
    return true;
  }

  var kindLabel = { ip: '보낸 곳', text: '문구' };

  function renderBlocks(blocks) {
    var list = $('block-list');
    list.textContent = '';
    if (!blocks.length) {
      var empty = document.createElement('li');
      empty.className = 'block-empty';
      empty.textContent = '아직 차단한 것이 없어요.';
      return list.appendChild(empty);
    }
    blocks.forEach(function (block) {
      var item = document.createElement('li');
      var kind = document.createElement('span');
      kind.className = 'block-kind';
      kind.textContent = kindLabel[block.kind] || block.kind;
      var value = document.createElement('span');
      value.className = 'block-value';
      value.textContent = block.value;
      var at = document.createElement('span');
      at.className = 'block-at';
      at.textContent = block.at || '';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'admin-link';
      remove.textContent = '차단 풀기';
      remove.setAttribute('aria-label', block.value + ' 차단 풀기');
      remove.addEventListener('click', function () {
        remove.disabled = true;
        changeBlocks('blocks/remove', block, block.value + ' 차단을 풀었어요.');
      });
      [kind, value, at, remove].forEach(function (el) { item.appendChild(el); });
      list.appendChild(item);
    });
  }

  function loadBlocks() {
    api('GET', 'blocks').then(function (data) {
      if (!data.ok) return;
      renderBlocks(data.blocks || []);
      if (!data.available) {
        say($('block-status'), '차단 목록 저장소(SPAM)가 아직 연결되지 않았어요. 다시 배포하면 만들어져요.', true);
      }
    }).catch(function () {});
  }

  function changeBlocks(path, body, done) {
    var status = $('block-status');
    return api('POST', path, body).then(function (data) {
      if (signedOut(data)) return false;
      if (!data.ok) {
        say(status, data.message || '저장하지 못했어요.', true);
        return false;
      }
      renderBlocks(data.blocks || []);
      say(status, done, 'ok');
      return true;
    }).catch(function () {
      say(status, '서버에 연결하지 못했어요.', true);
      return false;
    });
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

  $('block-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = event.target.querySelector('button');
    var value = $('b-value').value.trim();
    if (!value) {
      say($('block-status'), '차단할 값을 적어 주세요.', true);
      return $('b-value').focus();
    }
    button.disabled = true;
    changeBlocks('blocks', { kind: $('b-kind').value, value: value }, value + ' 차단했어요.').then(function (ok) {
      if (ok) $('b-value').value = '';
      button.disabled = false;
    });
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
      if (signedOut(data)) return;
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
