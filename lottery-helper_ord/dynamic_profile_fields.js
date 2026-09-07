(() => {
  const REGISTRY_URL =
    'https://raw.githubusercontent.com/shogonozawa0729-design/lottery-helper/main/rules/profile-fields.json';

  const FALLBACK = {
    schemaVersion: 1,
    version: 'fallback',
    fields: [
      {
        key: 'cardboxNumber',
        label: 'カードボックスの番号',
        type: 'text',
        inputMode: 'numeric',
        autocomplete: 'off'
      }
    ]
  };

  function validField(field) {
    return field &&
      /^[A-Za-z][A-Za-z0-9_]*$/.test(String(field.key || '')) &&
      String(field.label || '').trim();
  }

  function makeLabel(field, value) {
    const label = document.createElement('label');
    label.dataset.dynamicProfileField = field.key;

    const text = document.createTextNode(String(field.label));
    label.appendChild(text);

    const input = document.createElement('input');
    input.name = field.key;
    input.type = field.type || 'text';
    if (field.inputMode) input.inputMode = field.inputMode;
    input.autocomplete = field.autocomplete || 'off';
    if (field.placeholder) input.placeholder = field.placeholder;
    input.value = value == null ? '' : String(value);

    label.appendChild(input);

    if (field.hint) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = String(field.hint);
      label.appendChild(hint);
    }

    return label;
  }

  async function loadRegistry() {
    try {
      const url = REGISTRY_URL + '?t=' + Date.now();
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const json = await response.json();
      if (!json || !Array.isArray(json.fields)) throw new Error('invalid registry');
      return json;
    } catch (error) {
      console.warn('[LotteryHelper dynamic profile fields] registry fetch failed', error);
      return FALLBACK;
    }
  }

  async function init() {
    const form = document.getElementById('form');
    const grid = form?.querySelector('.grid');
    if (!form || !grid) return;

    const registry = await loadRegistry();
    const { profile = {} } = await chrome.storage.local.get('profile');

    const missing = registry.fields
      .filter(validField)
      .filter(field => !form.elements.namedItem(field.key));

    // Existing hard-coded/patched fields still get their saved value restored.
    for (const field of registry.fields.filter(validField)) {
      const existing = form.elements.namedItem(field.key);
      if (existing && profile[field.key] != null && !existing.value) {
        existing.value = profile[field.key];
      }
    }

    if (!missing.length) return;

    const title = document.createElement('div');
    title.className = 'wide sectionTitle';
    title.dataset.dynamicProfileSection = '1';
    title.textContent = '追加店舗・サービスID（GitHub自動更新）';
    grid.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'wide hint';
    hint.dataset.dynamicProfileSection = '1';
    hint.textContent =
      'ここはGitHubのプロフィール項目マスタから自動生成されます。今後、新しい店舗IDが追加されても拡張本体の入れ替えは不要です。';
    grid.appendChild(hint);

    for (const field of missing) {
      grid.appendChild(makeLabel(field, profile[field.key]));
    }
  }

  init().catch(error => {
    console.warn('[LotteryHelper dynamic profile fields]', error);
  });
})();
