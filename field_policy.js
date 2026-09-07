(() => {
  'use strict';
  if (globalThis.LATIASPolicy) return;
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const manual = /ログイン|サインイン|login|sign.?in|password|パスワード|captcha|recaptcha|hcaptcha|認証|本人確認|身分証|確認書類|ワンタイム|one.?time|\botp\b|sms|受取|受け取|受け取り|引取|引き取り|pickup|来店|受渡|店舗|応募店|購入店|アンケート|survey|questionnaire|好きな|お気に入り|利用頻度|参加頻度|よく使用|よく参加|決済|支払|payment|credit.?card|クレジット|セキュリティコード|待機列|queue/i;
  const negative = /同意しない|承諾しない|了承しない|希望しない|拒否|不要|いいえ|キャンセル|しません|not agree|disagree|decline|\bno\b/i;
  const final = /submit|purchase|payment|checkout|confirm|order|申込|申し込|申し込み|応募する|送信|確定|購入|注文|決済/i;
  const affirmative = /^(?:同意する|同意します|同意しました|承諾する|承諾します|了承する|了承します|はい|agree|yes)$|(?:規約|注意事項|個人情報|プライバシー).*(?:同意します|同意する|承諾します)/i;
  function ownText(el) {
    const labels = el.labels ? [...el.labels].map(x => x.textContent) : [];
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
    return normalize([...new Set([...labels, ...ids.map(id => document.getElementById(id)?.textContent),
      el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.closest('label')?.textContent].filter(Boolean).map(normalize))].join(' '));
  }
  function context(el) {
    const group = el.closest('fieldset,[role="listitem"],.question,.form-group,[class*="form_item"],[class*="field"]');
    const groupText = group && group !== el.form ? normalize(group.textContent).slice(0, 1600) : '';
    return { own: ownText(el), group, text: normalize([ownText(el), groupText, el.name, el.id, el.autocomplete].join(' ')) };
  }
  function pageAllowed() {
    const host = location.hostname, path = location.pathname;
    return (host === 'docs.google.com' && path.startsWith('/forms/d/')) ||
      (host === 'customform.jp' && path.startsWith('/form/input/')) ||
      (host === 'cloud-pass.jp' && path.startsWith('/tp/ticket/provision/')) ||
      (host === 'livepocket.jp' && path.startsWith('/purchase/confirm')) ||
      (['furu1.net', 'www.furu1.net'].includes(host) && path.startsWith('/news/news_information/'));
  }
  function base(el) {
    if (!pageAllowed()) return 'unsupported-page';
    if (!el || el.ownerDocument !== document || !el.isConnected) return 'stale-target';
    if (el.closest('button,a,[role="button"],[role="link"]') || el.hasAttribute('formaction')) return 'button-or-link';
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return 'unverified-custom-control';
    if (el.tagName === 'INPUT' && !['text','email','tel','number','date','checkbox','radio'].includes(el.type)) return 'forbidden-input-type';
    if (el.disabled || el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]')) return 'disabled-or-readonly';
    const style = getComputedStyle(el);
    if (el.hidden || style.display === 'none' || style.visibility === 'hidden' || !el.getClientRects().length) return 'hidden-control';
    const c = context(el);
    if (manual.test(c.text)) return 'manual-category';
    if (final.test(c.own) && !/^(?:商品)?(?:数量|購入数|希望数)(?:\s|$)/.test(c.own)) return 'final-action-context';
    if (el.form?.querySelector('input[type="password"],input[autocomplete="one-time-code"]')) return 'authentication-form';
    for (let node = el; node; node = node.parentElement) {
      if ([...node.attributes].some(a => /^on/i.test(a.name))) return 'inline-event-handler';
      if (node === el.form) break;
    }
    return '';
  }
  function kind(el) {
    const t = context(el).text;
    if (/数量|個数|購入数|希望数|quantity|box数|セット数/i.test(t)) return 'quantity';
    if (/生年月日|誕生日|birth|bday/i.test(t)) return 'birth';
    if (/メール|email|e-mail/i.test(t)) return 'email';
    if (/電話|携帯|phone|tel/i.test(t)) return 'phone';
    if (/郵便|postal|postcode|zip/i.test(t)) return 'postal';
    if (/ふりがな|フリガナ|カナ|kana/i.test(t)) return 'kana';
    if (/氏名|お名前|姓|苗字|名字|^名|fullname|first.?name|last.?name|given-name|family-name/i.test(t)) return 'name';
    if (/住所|都道府県|市区町村|番地|建物|address|prefecture/i.test(t)) return 'address';
    if (/プレイヤー|players?|会員番号|顧客ID|ポイントカード|twitter|Xアカウント/i.test(t)) return 'account';
    return '';
  }
  const keys = Object.freeze({
    lastName:'name', firstName:'name', fullNameExact:'name', __fullNameExact:'name',
    lastNameKana:'kana', firstNameKana:'kana', __fullKana:'kana', __fullKanaHiragana:'kana',
    email:'email', phone:'phone', postalCode:'postal', prefecture:'address', address1:'address', address2:'address', __fullAddress:'address',
    birthDate:'birth', __birthDate:'birth', __birthDateSlash:'birth', __birthDateCompact:'birth', __birthYear:'birth', __birthMonth:'birth', __birthDay:'birth',
    playersId:'account', playersName:'account', twitter:'account', tPointNumber:'account', cardLaboNumber:'account', toysrusNumber:'account', nojimaNumber:'account', batorocoNumber:'account', hareruyaNumber:'account', furuichiNumber:'account', mintNumber:'account', shop193Number:'account', yamashiroyaId:'account', trecaPlaza55Id:'account', cardboxNumber:'account', fukufukuNumber:'account'
  });
  function consent(el, option) {
    const c = context(el);
    const required = el.required || el.getAttribute('aria-required') === 'true' || c.group?.getAttribute('aria-required') === 'true' || /必須/.test(c.text);
    const own = normalize(option ? option.textContent : c.own);
    if (!required || !/(規約|注意事項|個人情報|プライバシー|terms|privacy)/i.test(c.text)) return false;
    if (negative.test(own) || !affirmative.test(own)) return false;
    if (/登録済|登録して|確認済|本人|持参|保存しました/i.test(c.text)) return false;
    return true;
  }
  function authorize(el, purpose, option, profileKey) {
    const reason = base(el);
    if (reason) return reason;
    if (!['profile','quantity','consent'].includes(purpose)) return 'forbidden-operation';
    if (purpose === 'consent') return consent(el, option) ? '' : 'not-required-affirmative-consent';
    if (el.type === 'checkbox' || el.type === 'radio') return 'not-a-value-field';
    const k = kind(el);
    if (purpose === 'quantity') return k === 'quantity' ? '' : 'not-quantity';
    if (!k || k === 'quantity') return 'unclassified-profile-field';
    if (profileKey && (!Object.hasOwn(keys, profileKey) || keys[profileKey] !== k)) return 'profile-key-mismatch';
    if (final.test(context(el).own)) return 'final-action-context';
    return '';
  }
  Object.defineProperty(globalThis, 'LATIASPolicy', { value: Object.freeze({ authorize, kind, negative, keys, context }), writable: false, configurable: false });
})();
