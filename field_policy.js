(() => {
  'use strict';
  if (globalThis.LATIASPolicy) return;
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const manual = /ログイン|サインイン|login|sign.?in|password|パスワード|captcha|recaptcha|hcaptcha|認証|本人確認|身分証|確認書類|ワンタイム|one.?time|\botp\b|sms|受取|受け取|受け取り|引取|引き取り|pickup|来店|受渡|店舗|応募店|購入店|アンケート|survey|questionnaire|好きな|お気に入り|利用頻度|参加頻度|よく使用|よく参加|決済|支払|payment|credit.?card|クレジット|セキュリティコード|待機列|queue/i;
  const negative = /同意しない|承諾しない|了承しない|希望しない|拒否|不要|いいえ|キャンセル|しません|not agree|disagree|decline|\bno\b/i;
  const final = /submit|purchase|payment|checkout|confirm|order|申込|申し込|申し込み|応募する|送信|確定|購入|注文|決済/i;
  const affirmative = /^(?:同意する|同意します|同意しました|承諾する|承諾します|了承する|了承します|はい|agree|yes)$|(?:規約|注意事項|個人情報|プライバシー).*(?:同意します|同意する|承諾します)/i;
  const optional = /任意|optional|必須では(?:ない|ありません)|必須でない/i;
  function ownText(el) {
    const labels = el.labels ? [...el.labels].map(x => x.textContent) : [];
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
    return normalize([...new Set([...labels, ...ids.map(id => document.getElementById(id)?.textContent),
      el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.closest('label')?.textContent].filter(Boolean).map(normalize))].join(' '));
  }
  function googleQuestion(el) {
    if (location.protocol !== 'https:' || location.hostname !== 'docs.google.com' || !location.pathname.startsWith('/forms/d/')) return null;
    const boundary = '[role="listitem"],.Qr7Oae,.geS5n,.freebirdFormviewerViewItemsItemItem';
    const titleSelector = '[role="heading"],.M7eMe,.freebirdFormviewerViewItemsItemItemTitle';
    // Skip choice wrappers, but never search the form/body or borrow a sibling's title.
    for (let group = el?.parentElement; group && !['FORM','BODY','HTML'].includes(group.tagName); group = group.parentElement) {
      if (!group.matches(boundary)) continue;
      const titles = [...group.querySelectorAll(titleSelector)].filter(t =>
        !t.closest('[role="checkbox"],[role="radio"],button,a') &&
        !t.parentElement?.closest(titleSelector));
      if (!titles.length) continue;
      if (titles.length !== 1) return null;
      const title = titles[0];
      for (let parent = title.parentElement; parent && parent !== group; parent = parent.parentElement) {
        if (parent.matches(boundary) && !parent.contains(el)) return null;
      }
      const header = title.closest('[role="heading"],.HoXoMd,.freebirdFormviewerViewItemsItemItemHeader') || title;
      if (!group.contains(header) || header.querySelector('input,select,textarea,[role="checkbox"],[role="radio"]')) return null;
      const text = normalize(header.textContent);
      if (!text) return null;
      return { group, title: header, text };
    }
    return null;
  }
  function context(el) {
    const group = googleQuestion(el)?.group || el.closest('fieldset,[role="listitem"],.Qr7Oae,.geS5n,.question,.form-group,[class*="form_item"],[class*="field"]');
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
  function googleAria(el) {
    if (location.protocol !== 'https:' || location.hostname !== 'docs.google.com' || !location.pathname.startsWith('/forms/')) return false;
    if (el?.tagName !== 'DIV' || !['checkbox','radio'].includes(el.getAttribute('role'))) return false;
    if (!['true','false'].includes(el.getAttribute('aria-checked')) || !['0','-1'].includes(el.getAttribute('tabindex'))) return false;
    if (!el.getAttribute('jscontroller') || !/(?:^|;)\s*click:/.test(el.getAttribute('jsaction') || '')) return false;
    if (['href','type','formaction'].some(a => el.hasAttribute(a)) || el.querySelector('button,a,input,select,textarea,[role="button"],[role="link"]')) return false;
    const form = el.closest('form');
    if (!form || String(form.method).toLowerCase() !== 'post') return false;
    try {
      const action = new URL(form.action, location.href);
      const formPath = location.pathname.replace(/\/(?:viewform|formResponse)$/, '');
      if (action.origin !== location.origin || action.pathname !== formPath + '/formResponse') return false;
    } catch { return false; }
    return true;
  }
  function questionText(group) {
    if (!group) return '';
    const title = group.querySelector('legend,[role="heading"]');
    return normalize(title?.textContent || group.textContent).slice(0,1600);
  }
  function requiredEvidence(el) {
    const c = context(el);
    const question = googleQuestion(el);
    if (googleAria(el) && !question) return false;
    const ariaGroup = el.closest('[role="radiogroup"],[role="group"]');
    // An optional marker always wins, even if a distant/contradictory required flag exists.
    if (optional.test(c.own) || optional.test(question?.text || questionText(c.group))) return false;
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    if (c.group && ariaGroup && c.group.contains(ariaGroup) && ariaGroup.getAttribute('aria-required') === 'true') return true;
    if (c.group?.getAttribute('aria-required') === 'true') return true;
    const title = question?.title || c.group?.querySelector('legend,[role="heading"]');
    return !!title && (/必須/.test(title.textContent) || !!title.querySelector('[aria-label="必須の質問"],[aria-label="Required question"]'));
  }
  function googleEmail(el) {
    if (!googleAria(el) || el.getAttribute('role') !== 'checkbox' || !requiredEvidence(el)) return false;
    // Whole aria-label only. No parent-text, id or prefix/substring fallbacks.
    const text = normalize(el.getAttribute('aria-label'));
    return /^返信に表示するメールアドレスとして(?:\s*[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\s*を)?記録する$/.test(text);
  }
  function product(el) {
    if (el?.tagName !== 'INPUT' || el.type !== 'checkbox' || (el.hasAttribute('role') && el.getAttribute('role') !== 'checkbox')) return false;
    const c = context(el), question = questionText(c.group);
    if (!c.group || !/(応募商品|購入希望商品|希望する商品|希望商品|商品選択)/.test(question)) return false;
    if (!c.own || negative.test(c.own) || /応募しない|購入しない|選択しない|該当なし|その他|なし$/.test(c.own)) return false;
    if (/(規約|同意|承諾|個人情報|プライバシー|terms|privacy)/i.test(c.text)) return false;
    if (manual.test(c.text) || /申込|申し込|応募する|購入する|送信|確定|注文|決済|submit|checkout|confirm|purchase now/i.test(c.own)) return false;
    // No arbitrary allocation when a selection-count constraint exists.
    if (/いずれか|一つ|ひとつ|1つ|(?:最大|上限)\s*\d+|\d+\s*(?:つ|点|個|商品|種類).*まで/.test(question)) return false;
    return true;
  }
  function identityNameField(el, purpose, c) {
    if (purpose !== 'profile' || el.tagName !== 'INPUT' || el.type !== 'text' ||
        (el.hasAttribute('role') && el.getAttribute('role') !== 'textbox')) return false;
    if (!/(?:身分証(?:明書)?|本人確認書類|確認書類).{0,24}記載.{0,24}(?:氏名|お名前|姓名|フルネーム)/.test(c.text)) return false;
    if (/アップロード|upload|添付|提出|選択|確認済|確認しました|認証|番号|コード/i.test(c.text)) return false;
    // Remove only the document reference; every other manual category still wins.
    return !manual.test(c.text.replace(/本人確認書類|身分証明書|身分証|確認書類/g, '')) && kind(el) === 'name';
  }
  function base(el, purpose) {
    if (!pageAllowed()) return 'unsupported-page';
    if (!el || el.ownerDocument !== document || !el.isConnected) return 'stale-target';
    if (el.closest('button,a,[role="button"],[role="link"]') || el.hasAttribute('formaction')) return 'button-or-link';
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !(['consent','google-email'].includes(purpose) && googleAria(el))) return 'unverified-custom-control';
    if (el.tagName === 'INPUT' && !['text','email','tel','number','date','checkbox','radio'].includes(el.type)) return 'forbidden-input-type';
    if (el.disabled || el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]')) return 'disabled-or-readonly';
    const style = getComputedStyle(el);
    if (el.hidden || style.display === 'none' || style.visibility === 'hidden' || !el.getClientRects().length) return 'hidden-control';
    const c = context(el);
    if (manual.test(c.text) && !identityNameField(el, purpose, c)) return 'manual-category';
    if (final.test(c.own) && !/^(?:商品)?(?:数量|購入数|希望数)(?:\s|$)/.test(c.own) && !(purpose === 'product' && product(el))) return 'final-action-context';
    const form = el.form || el.closest('form');
    if (form?.querySelector('input[type="password"],input[autocomplete="one-time-code"]')) return 'authentication-form';
    for (let node = el; node; node = node.parentElement) {
      if ([...node.attributes].some(a => /^on/i.test(a.name))) return 'inline-event-handler';
      if (node === form) break;
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
    const required = requiredEvidence(el);
    const own = normalize(option ? option.textContent : c.own);
    if (!required || !/(規約|注意事項|個人情報|プライバシー|terms|privacy)/i.test(c.text)) return false;
    if (negative.test(own) || !affirmative.test(own)) return false;
    if (/登録済|登録して|確認済|本人|持参|保存しました/i.test(c.text)) return false;
    return true;
  }
  function authorize(el, purpose, option, profileKey) {
    const reason = base(el, purpose);
    if (reason) return reason;
    if (!['profile','quantity','consent','google-email','product'].includes(purpose)) return 'forbidden-operation';
    if (purpose === 'google-email') return googleEmail(el) ? '' : 'not-google-email-recording';
    if (purpose === 'product') return product(el) ? '' : 'not-eligible-native-product';
    if (purpose === 'consent') return consent(el, option) ? '' : 'not-required-affirmative-consent';
    if (el.type === 'checkbox' || el.type === 'radio') return 'not-a-value-field';
    const k = kind(el);
    if (purpose === 'quantity') return k === 'quantity' ? '' : 'not-quantity';
    if (!k || k === 'quantity') return 'unclassified-profile-field';
    if (profileKey && (!Object.hasOwn(keys, profileKey) || keys[profileKey] !== k)) return 'profile-key-mismatch';
    if (final.test(context(el).own)) return 'final-action-context';
    return '';
  }
  Object.defineProperty(globalThis, 'LATIASPolicy', { value: Object.freeze({ authorize, kind, negative, keys, context, googleAria, googleQuestion, requiredEvidence }), writable: false, configurable: false });
})();
