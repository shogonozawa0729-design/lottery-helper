const statusEl = document.getElementById('status');
const memberEl = document.getElementById('member');
const ruleStatusEl = document.getElementById('ruleStatus');

const RULE_BASE = 'https://raw.githubusercontent.com/shogonozawa0729-design/lottery-helper/main/';
const RULE_CACHE_KEY = 'remoteRuleBundleV2';
const CORE_BUILD = '2026.09.06.56';

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

async function ensureGoogleFormCheckboxes(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const negative = /(同意しない|承諾しない|了承しない|希望しない|応募しない|購入しない|不要|キャンセル|受け取らない|受取らない)/i;

        const norm = value => String(value || '')
          .normalize('NFKC')
          .replace(/\s+/g, ' ')
          .trim();

        const isOn = el => {
          if (!el) return false;
          if (el.matches?.('input[type="checkbox"]')) return !!el.checked;
          return String(el.getAttribute?.('aria-checked') || '').toLowerCase() === 'true';
        };

        const candidates = [...document.querySelectorAll(
          'div[role="checkbox"], input[type="checkbox"]'
        )].filter(el => {
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
            await wait(30);
            if (isOn(el)) continue;
            el.click();
            await wait(100);
            if (isOn(el)) changed++;
          } catch {}
        }

        return {
          total: candidates.length,
          changed,
          on: candidates.filter(isOn).length
        };
      }
    });

    return results?.[0]?.result || { total: 0, changed: 0, on: 0 };
  } catch (e) {
    return { total: 0, changed: 0, on: 0, error: e.message || String(e) };
  }
}

async function queryWebTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter(t => t.id && /^https?:\/\//.test(t.url || ''))
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      return { ok: false, reason: e2.message || String(e2) };
    }
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

async function currentRules() {
  return await syncRemoteRules();
}

async function applyMessageAcrossRules(tabId, type, profile, rules, genericConfig) {
  const ruleList = rules.length ? rules : [null];
  let changed = 0;
  let anyOk = false;
  const details = [];
  let lastReason = '';

  for (const rule of ruleList) {
    const res = await sendToTab(tabId, {
      type,
      profile,
      rule,
      genericConfig: genericConfig || {}
    });

    if (res?.ok) {
      anyOk = true;
      changed += Number(res.changed || 0);
      if (res.detail) details.push(res.detail);
    } else if (res?.reason) {
      lastReason = res.reason;
    }
  }

  return {
    ok: anyOk,
    changed,
    detail: details.filter(Boolean).join(' + '),
    reason: lastReason
  };
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
    if (!tab?.id) {
      skipped++;
      continue;
    }
    try {
      await chrome.tabs.reload(tab.id);
      reloaded++;
    } catch {
      skipped++;
    }
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
  const bundle = await currentRules();
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

    setStatus(`${i + 1}/${tabs.length} 左から順に処理中…\n${label}`);

    const fillRes = await applyMessageAcrossRules(
      tab.id,
      'FILL_FORM',
      profile,
      rules,
      bundle.genericConfig || {}
    );

    if (fillRes?.ok) filled += fillRes.changed || 0;

    let agreeRes;
    if (googleForm) {
      // ルールエンジンの実装差があるChromeプロファイルでもcheckboxを確実にONへ寄せる。
      // OFFだけをクリックし、ON済みは触らないためトグル化しない。
      const sweep = await ensureGoogleFormCheckboxes(tab.id);
      agreed += Number(sweep.changed || 0);
      agreeRes = {
        ok: !sweep.error,
        changed: sweep.changed || 0,
        detail: `checkbox ${sweep.on || 0}/${sweep.total || 0} ON${sweep.error ? `（${sweep.error}）` : ''}`
      };
    } else {
      agreeRes = await applyMessageAcrossRules(
        tab.id,
        'AGREE_TERMS',
        profile,
        rules,
        bundle.genericConfig || {}
      );
      if (agreeRes?.ok) agreed += agreeRes.changed || 0;
    }

    if (fillRes?.ok || agreeRes?.ok) {
      completedTabs++;
      const fillDetail = fillRes?.detail || `${fillRes?.changed || 0}項目`;
      const agreeDetail = agreeRes?.detail || `${agreeRes?.changed || 0}同意`;
      details.push(`${label}: 入力 ${fillDetail} / 同意 ${agreeDetail}`);
    } else {
      failedTabs++;
      details.push(`${label}: スキップ/失敗 ${fillRes?.reason || agreeRes?.reason || '処理不可'}`);
    }
  }

  setStatus(
    `全タブ一括処理完了: ${completedTabs}/${tabs.length}タブ\n` +
    `入力 ${filled}項目 / 同意 ${agreed}件` +
    `${failedTabs ? ` / 処理不可 ${failedTabs}タブ` : ''}\n` +
    `${details.slice(0, 8).join('\n')}${details.length > 8 ? '\n…' : ''}\n` +
    `※左のタブから順番に処理。Google Formsのcheckboxは本体側でもOFF→ONを再確認し、ON→OFFにはしません。最終送信は押しません。`
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
