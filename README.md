# LATIAS

抽選応募フォームの入力補助Chrome拡張です。レビュー候補版 **0.9.8.3 / Phase 1.2**。
正式ソースはリポジトリ直下の manifest.json を起点とする一系統です。Draft PR #2でレビュー中で、実運用への反映は未実施です。

- プロフィールは Chrome の chrome.storage.local の profile に保存。既存の保存形式を維持します。
- 応募先DOMへの操作は Safety Gateway を経由します。最終申込・送信・購入・確定・決済、button/linkは自動操作しません。
- 必須肯定同意、条件を満たすnative商品checkbox、数量最大化、プロフィール入力を補助します。Google FormsのARIA同意とメール記録は専用の制限付き操作です。
- ログイン・CAPTCHA・本人確認・受取日・店舗・アンケートは手動です。
- 入力処理は現在タブと右側のWebタブだけが対象です。一斉リロードの既存仕様は維持しています。

[Phase 1.2の修正と制限](docs/PHASE12.md)、[テスト結果](docs/TEST_RESULTS.md)、[統合元とChrome読み込み元の確認方法](docs/PHASE01.md)を参照してください。

ルールは候補データであり権限を付与しません。selectorやラベルが一致してもpolicyが拒否すれば操作しません。remote rulesのschema全面移行は行っていません。
ord/backupと旧extensionスクリプトは実行ツリーから除外し、履歴とdocsのハッシュで追跡します。extension/にはルートへの案内だけを置きます。
