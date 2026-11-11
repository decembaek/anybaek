// 상담 요청 폼: /api/contact 로 보내고 결과를 폼 아래에 알려 준다.
(function () {
  var form = document.getElementById('contact-form');
  var status = document.getElementById('form-status');
  if (!form || !status) return;

  var button = form.querySelector('button[type="submit"]');
  var defaultLabel = button.textContent;

  function say(text, strong) {
    status.textContent = text;
    status.classList.toggle('is-strong', !!strong);
  }

  // 자바스크립트 없이 보낸 뒤 돌아온 경우(?sent=1 / ?sent=0)
  var sent = new URLSearchParams(location.search).get('sent');
  if (sent === '1') say('상담 요청을 보냈어요. 확인하는 대로 연락드릴게요.', true);
  if (sent === '0') say('보내지 못했어요. 잠시 뒤에 다시 시도하거나 contact@anybaek.com으로 메일을 보내 주세요.', true);

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

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var invalid = firstInvalid();
    if (invalid) {
      say(messages[invalid], true);
      form.elements[invalid].focus();
      return;
    }

    var payload = {};
    new FormData(form).forEach(function (value, key) { payload[key] = String(value); });

    button.disabled = true;
    button.textContent = '보내는 중이에요';
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
        say(error.message || '보내지 못했어요. 잠시 뒤에 다시 시도하거나 contact@anybaek.com으로 메일을 보내 주세요.', true);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = defaultLabel;
      });
  });
})();
