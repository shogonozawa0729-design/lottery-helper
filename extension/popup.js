const statusEl = document.getElementById('status');
const memberEl = document.getElementById('member');
const ruleStatusEl = document.getElementById('ruleStatus');

const RULE_BASE = 'https://raw.githubusercontent.com/shogonozawa0729-design/lottery-helper/main/';
const RULE_CACHE_KEY = 'remoteRuleBundleV2';
const CORE_BUILD = '2026.09.06.57';

function setStatus(text) {
  statusEl.textContent = text;
}

async function getProfile() {
  const { profile } = await chrome.storage.local.get('profile');
  return profile || null;
}

async function renderProfile() {
  const p = await getProfile();
  if (!p) {
    memberEl.textContent = 'メンバー未設定';
    return;
  }
  memberEl.textContent = `${p.lastName || ''} ${p.firstName || ''} / ${p.email || ''}`;
}

function parseUrls(text) {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) || [];
  return [...new Set(matches.map(u => u.replace(/[),.;]+$/g, '')))];
}

function isGoogleFormUrl(urlText) {
  try {
    const u = new URL(urlText);
    return u.hostname === 'docs.google.com' && u.pathname.startsWith('/forms/d/');
  } catch {
    return false;
  }
}

function isCustomFormUrl(urlText) {
  try {
    const u = new URL(urlText);
    return u.hostname === 'customform.jp' && u.pathname.startsWith('/form/input/');
  } catch {
    return false;
  }
}

async function ensureOptionalEngines(tabId) {
  for (const file of ['rule_enhancer.js', 'question_mapper.js']) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch {}
  }
}

async function queryWebTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter(t => t.id && /^https?:\/\//.test(t.url || ''))
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
}

async function sendToTab(tabId, message) {
  await ensureOptionalEngines(tabId);
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await ensureOptionalEngines(tabId);
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      return { ok: false, reason: e2.message || String(e2) };
    }
  }
}

async function ensureGoogleFormCheckboxes(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const negative = /(同意しない|承諾しない|了承しない|希望しない|応募しない|購入しない|不要|キャンセル|受け取らない|受取らない)/i;
        const norm = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
        const isOn = el => {
          if (!el) return false;
          if (el.matches?.('input[type="checkbox"]')) return !!el.checked;
          return String(el.getAttribute?.('aria-checked') || '').toLowerCase() === 'true';
        };

        const candidates = [...document.querySelectorAll('div[role="checkbox"], input[type="checkbox"]')]
          .filter(el => {
            if (el.disabled) return false;
            if (String(el.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true') return false;
            const ownText = norm([
              el.getAttribute?.('aria-label'),
              el.closest?.('label')?.innerText,
              el.labels ? [...el.labels].map(l => l.innerText).join(' ') : ''
            ].filter(Boolean).join(' '));
            return !negative.test(ownText);
          });

        let changed = 0;
        for (const el of candidates) {
          if (isOn(el)) continue;
          try {
            el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
            await wait(25);
            if (isOn(el)) continue;
            el.click();
            await wait(100);
            if (isOn(el)) changed++;
          } catch {}
        }

        return { total: candidates.length, changed, on: candidates.filter(isOn).length };
      }
    });
    return results?.[0]?.result || { total: 0, changed: 0, on: 0 };
  } catch (e) {
    return { total: 0, changed: 0, on: 0, error: e.message || String(e) };
  }
}

async function fillCustomFormCore(tabId, profile) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [profile],
      func: (p) => {
        const norm = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
        const kanaToHiragana = value => String(value || '').replace(/[ァ-ヶ]/g, ch =>
          String.fromCharCode(ch.charCodeAt(0) - 0x60)
        );
        const fullName = p.fullName || [p.lastName, p.firstName].filter(Boolean).join(' ');
        const fullKana = p.fullKana || [p.lastNameKana, p.firstNameKana].filter(Boolean).join(' ');
        const fullKanaHiragana = kanaToHiragana(fullKana);
        const fullAddress = p.fullAddress || p.address || [
          p.prefecture, p.city, p.address1, p.address2, p.building
        ].filter(Boolean).join('');
        const birthDate = p.birthDate || p.birthday || '';

        const mappings = [
          { key: 'name', rx: /お名前.*(?:漢字|本名|本人確認|身分証)|(?:氏名|本名).*(?:漢字|本人確認|身分証)|身分証.*お名前|氏名.*フルネーム|お名前.*フルネーム/i, value: fullName, transform: 'trim' },
          { key: 'kana', rx: /お名前.*(?:ふりがな|フリガナ)|(?:ふりがな|フリガナ).*お名前|ひらがな.*本名|本名.*ひらがな/i, value: fullKanaHiragana, transform: 'trim' },
          { key: 'address', rx: /ご住所|住所.*(?:マンション|アパート|番地|都道府県|市町村)|現住所|住所を入力/i, value: fullAddress, transform: 'trim' },
          { key: 'birthDate', rx: /生年月日|誕生日|生まれた日/i, value: birthDate, transform: 'date' },
          { key: 'email', rx: /メールアドレス|E.?mail|e.?mail|連絡先.*メール|当選.*メール/i, value: p.email || '', transform: 'trim' },
          { key: 'phone', rx: /電話番号|携帯番号|携帯電話|TEL|Tel|tel/i, value: p.phone || '', transform: 'digits' },
          { key: 'playersId', rx: /プレイヤーズクラブ.*ID|プレイヤー.?ID|トレーナーズウェブサイト.*ID/i, value: p.playersId || '', transform: 'digits' },
          { key: 'playersName', rx: /プレイヤー.?ネーム|プレイヤーズネーム/i, value: p.playersName || '', transform: 'trim' },
          { key: 'twitter', rx: /X\(旧Twitter\).*アカウント|X\(旧Twitter\).*ID|Twitter.*アカウント|Twitter.*ID/i, value: p.twitter || '', transform: 'trim' }
        ];

        const isTextLike = el => {
          if (!el || el.disabled) return false;
          if (el.tagName === 'TEXTAREA') return true;
          if (el.tagName !== 'INPUT') return false;
          return ['text', 'number', 'tel', 'email', 'search', 'url', 'date'].includes(String(el.type || 'text').toLowerCase());
        };

        const allInteractive = [...document.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"]), textarea, select'
        )].filter(el => !el.disabled);

        const textBetweenPrevious = el => {
          try {
            const index = allInteractive.indexOf(el);
            if (index < 0) return '';
            const previous = index > 0 ? allInteractive[index - 1] : null;
            const range = document.createRange();
            if (previous) range.setStartAfter(previous);
            else range.setStart(document.body, 0);
            range.setEndBefore(el);
            return norm(range.toString()).slice(-1800);
          } catch {
            return '';
          }
        };

        const directText = el => norm([
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('placeholder'),
          el.closest?.('label')?.innerText,
          el.labels ? [...el.labels].map(l => l.innerText).join(' ') : ''
        ].filter(Boolean).join(' '));

        const mappingFor = el => {
          for (const text of [directText(el), textBetweenPrevious(el)]) {
            if (!text) continue;
            const hits = mappings.filter(m => m.rx.test(text));
            const uniqueKeys = [...new Set(hits.map(h => h.key))];
            if (uniqueKeys.length === 1) return hits[0];
          }
          return null;
        };

        const transformValue = (mapping, el) => {
          let value = String(mapping.value || '');
          if (mapping.transform === 'digits') value = value.replace(/[^0-9]/g, '');
          if (mapping.transform === 'date') {
            const digits = value.replace(/[^0-9]/g, '');
            if (digits.length === 8) {
              value = String(el.type || '').toLowerCase() === 'date'
                ? `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`
                : `${digits.slice(0,4)}/${digits.slice(4,6)}/${digits.slice(6,8)}`;
            }
          }
          return value.trim();
        };

        const setValue = (el, value) => {
          if (!value || String(el.value || '').trim() !== '') return false;
          try {
            const proto = Object.getPrototypeOf(el);
            const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc?.set) desc.set.call(el, value);
            else el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return String(el.value || '') === value;
          } catch {
            return false;
          }
        };

        let changed = 0;
        const details = [];
        for (const el of allInteractive.filter(isTextLike)) {
          const mapping = mappingFor(el);
          if (!mapping) continue;
          const value = transformValue(mapping, el);
          if (!value) continue;
          if (setValue(el, value)) {
            changed++;
            details.push(mapping.key);
          }
        }

        return { changed, details };
      }
    });

    return results?.[0]?.result || { changed: 0, details: [] };
  } catch (e) {
    return { changed: 0, details: [], error: e.message || String(e) };
  }
}

async function ensureCustomFormConsents(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const negative = /(同意しない|承諾しない|了承しない|希望しない|応募しない|購入しない|不要|キャンセル|受け取らない|受取らない)/i;
        const candidates = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
          .filter(el => {
            if (el.disabled) return false;
            const text = String([
              el.value,
              el.closest?.('label')?.innerText,
              el.labels ? [...el.labels].map(l => l.innerText).join(' ') : ''
            ].filter(Boolean).join(' ')).normalize('NFKC');
            if (negative.test(text)) return false;
            if (el.type === 'checkbox') return true;
            return /(同意|了承|承諾|確認|間違いありません|保存しました)/i.test(text);
          });

        let changed = 0;
        for (const el of candidates) {
          if (el.checked) continue;
          try {
            const proto = Object.getPrototypeOf(el);
            const desc = proto && Object.getOwnPropertyDescriptor(proto, 'checked');
            if (desc?.set) desc.set.call(el, true);
            else el.checked = true;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (el.checked) changed++;
          } catch {}
        }
        return { total: candidates.length, changed, on: candidates.filter(el => el.checked).length };
      }
    });
    return results?.[0]?.result || { total: 0, changed: 0, on: 0 };
  } catch (e) {
    return { total: 0, changed: 0, on: 0, error: e.message || String(e) };
  }
}

async function fetchJson(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${RULE_BASE}${path}${sep}_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return await res.json();
}

async function syncRemoteRules() {
  try {
    const index = await fetchJson('rules/index.json');
    const rules = [];
    for (const adapter of (index.adapters || [])) {
      if (!adapter.enabled || !adapter.file) continue;
      rules.push(await fetchJson(adapter.file));
    }
    const bundle = {
      fetchedAt: Date.now(),
      rulesVersion: index.rulesVersion || '',
      genericConfig: index.generic || {},
      rules
    };
    await chrome.storage.local.set({ [RULE_CACHE_KEY]: bundle });
    ruleStatusEl.textContent = `本体 ${CORE_BUILD} / 共通ルール GitHub ${bundle.rulesVersion || '最新版'}`;
    return bundle;
  } catch (e) {
    const cached = (await chrome.storage.local.get(RULE_CACHE_KEY))[RULE_CACHE_KEY];
    if (cached?.rules?.length) {
      ruleStatusEl.textContent = `本体 ${CORE_BUILD} / 共通ルール キャッシュ ${cached.rulesVersion || ''}`;
      return cached;
    }
    ruleStatusEl.textContent = `本体 ${CORE_BUILD} / 共通ルール GitHub取得失敗`;
    return { fetchedAt: 0, rulesVersion: '', genericConfig: {}, rules: [] };
  }
}

function ruleMatchesUrl(rule, u) {
  const match = rule?.match || {};
  const hosts = Array.isArray(match.hosts) ? match.hosts : [];
  if (hosts.length && !hosts.includes(u.hostname)) return false;
  const prefixes = Array.isArray(match.pathPrefixes) ? match.pathPrefixes : [];
  if (prefixes.length && !prefixes.some(prefix => u.pathname.startsWith(prefix))) return false;
  return true;
}

function rulesForUrl(bundle, urlText) {
  try {
    const u = new URL(urlText);
    return (bundle?.rules || []).filter(rule => ruleMatchesUrl(rule, u));
  } catch {
    return [];
  }
}

async function applyMessageAcrossRules(tabId, type, profile, rules, genericConfig) {
  const ruleList = rules.length ? rules : [null];
  let changed = 0;
  let anyOk = false;
  const details = [];
  let lastReason = '';

  for (const rule of ruleList) {
    const res = await sendToTab(tabId, { type, profile, rule, genericConfig: genericConfig || {} });
    if (res?.ok) {
      anyOk = true;
      changed += Number(res.changed || 0);
      if (res.detail) details.push(res.detail);
    } else if (res?.reason) {
      lastReason = res.reason;
    }
  }
  return { ok: anyOk, changed, detail: details.filter(Boolean).join(' + '), reason: lastReason };
}

document.getElementById('openUrls').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const urls = parseUrls(text);
    if (!urls.length) {
      setStatus('クリップボードからURLを検出できませんでした。');
      return;
    }
    for (const url of urls) await chrome.tabs.create({ url, active: false });
    setStatus(`${urls.length}件のURLを開きました。\nログインが必要なサイトは手動でログインしてください。`);
  } catch (e) {
    setStatus(`クリップボード読取に失敗: ${e.message || e}`);
  }
});

document.getElementById('reloadTabs').addEventListener('click', async () => {
  const tabs = await queryWebTabs();
  let reloaded = 0;
  let skipped = 0;
  for (const tab of tabs) {
    if (!tab?.id) { skipped++; continue; }
    try { await chrome.tabs.reload(tab.id); reloaded++; } catch { skipped++; }
  }
  setStatus(`${reloaded}タブを左から順にリロードしました。${skipped ? `（${skipped}タブはスキップ）` : ''}`);
});

const fillAllButton = document.getElementById('fillForms');
const legacyAgreeButton = document.getElementById('agreeTerms');
if (fillAllButton) fillAllButton.textContent = '③ 開いている全タブを入力＋同意';
if (legacyAgreeButton) {
  legacyAgreeButton.style.display = 'none';
  legacyAgreeButton.setAttribute('aria-hidden', 'true');
}

fillAllButton?.addEventListener('click', async () => {
  const profile = await getProfile();
  if (!profile) {
    setStatus('先に「メンバー設定」をしてください。');
    return;
  }

  setStatus('GitHubから最新ルールを確認しています…');
  const bundle = await syncRemoteRules();
  const tabs = await queryWebTabs();
  if (!tabs.length) {
    setStatus('処理できるWebタブがありません。');
    return;
  }

  let filled = 0;
  let agreed = 0;
  let completedTabs = 0;
  let failedTabs = 0;
  const details = [];

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const label = tab.title || tab.url || `tab:${tab.id}`;
    const rules = rulesForUrl(bundle, tab.url);
    const googleForm = isGoogleFormUrl(tab.url);
    const customForm = isCustomFormUrl(tab.url);

    setStatus(`${i + 1}/${tabs.length} 左から順に処理中…\n${label}`);

    let fillRes;
    if (customForm) {
      const direct = await fillCustomFormCore(tab.id, profile);
      fillRes = {
        ok: !direct.error,
        changed: direct.changed || 0,
        detail: `CustomForm直結 ${direct.changed || 0}項目${direct.details?.length ? ` [${direct.details.join(', ')}]` : ''}${direct.error ? `（${direct.error}）` : ''}`
      };
    } else {
      fillRes = await applyMessageAcrossRules(tab.id, 'FILL_FORM', profile, rules, bundle.genericConfig || {});
    }
    if (fillRes?.ok) filled += fillRes.changed || 0;

    let agreeRes;
    if (googleForm) {
      const sweep = await ensureGoogleFormCheckboxes(tab.id);
      agreed += Number(sweep.changed || 0);
      agreeRes = {
        ok: !sweep.error,
        changed: sweep.changed || 0,
        detail: `checkbox ${sweep.on || 0}/${sweep.total || 0} ON${sweep.error ? `（${sweep.error}）` : ''}`
      };
    } else if (customForm) {
      const sweep = await ensureCustomFormConsents(tab.id);
      agreed += Number(sweep.changed || 0);
      agreeRes = {
        ok: !sweep.error,
        changed: sweep.changed || 0,
        detail: `CustomForm同意 ${sweep.on || 0}/${sweep.total || 0} ON${sweep.error ? `（${sweep.error}）` : ''}`
      };
    } else {
      agreeRes = await applyMessageAcrossRules(tab.id, 'AGREE_TERMS', profile, rules, bundle.genericConfig || {});
      if (agreeRes?.ok) agreed += agreeRes.changed || 0;
    }

    if (fillRes?.ok || agreeRes?.ok) {
      completedTabs++;
      details.push(`${label}: 入力 ${fillRes?.detail || `${fillRes?.changed || 0}項目`} / 同意 ${agreeRes?.detail || `${agreeRes?.changed || 0}件`}`);
    } else {
      failedTabs++;
      details.push(`${label}: スキップ/失敗 ${fillRes?.reason || agreeRes?.reason || '処理不可'}`);
    }
  }

  setStatus(
    `全タブ一括処理完了: ${completedTabs}/${tabs.length}タブ\n` +
    `入力 ${filled}項目 / 同意 ${agreed}件` +
    `${failedTabs ? ` / 処理不可 ${failedTabs}タブ` : ''}\n` +
    `${details.slice(0, 10).join('\n')}${details.length > 10 ? '\n…' : ''}\n` +
    `※左から順に処理。Google Forms/CustomFormの同意は本体がOFF→ONのみ保証。既存入力は上書きしません。最終送信は押しません。`
  );
});

document.getElementById('inspectForm').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) {
    setStatus('抽選の応募入力ページを表示したタブで実行してください。');
    return;
  }
  const res = await sendToTab(tab.id, { type: 'INSPECT_FORM' });
  if (!res?.ok) {
    setStatus(`フォーム構造の取得に失敗: ${res?.reason || '不明なエラー'}`);
    return;
  }
  const text = JSON.stringify(res.data, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`フォーム構造を取得しました（${res.data?.controls?.length || 0}要素）。\nクリップボードへコピー済みです。\nこのままChatGPTに貼り付けてください。\n※入力値・パスワードは取得していません。`);
  } catch (e) {
    setStatus(`構造は取得できましたがコピーに失敗しました: ${e.message || e}`);
  }
});

renderProfile();
syncRemoteRules();
