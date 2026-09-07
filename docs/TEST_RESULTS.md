# Phase 0 / Phase 1 テスト結果

2026-09-07に実施。Node.js標準test runner、Playwright 1.62.1、headless Microsoft Edgeを使用。

**17テスト成功、失敗0。** JavaScript構文検査および `git diff --check` も実施。

優先確認:

- 悪意あるremote selectorがsubmit/button/link/imageや偽装checkboxを指しても、DOM変更・click/input/change/blur/submit等のイベントが0。
- remote compilerはDOMのないVM内でも動作し、操作候補だけを返す。overwrite/allowReadOnlyを引き継がない。
- 必須・肯定・規約等の同意が揃ったnative部品だけON。任意項目、拒否、既存radio選択は変更しない。
- ログイン/CAPTCHA/本人確認/受取日/店舗/任意アンケート、hidden/readonly/ARIA偽装/inlineイベントを拒否。
- 通常プロフィール入力、既存値保持、ordの空白補正で英字sを保持。
- 数量のmax空欄、既存値、単位付きoption、disabled option/optgroup。
- 未対応ホスト、認証フォーム、切り離されたDOM、URL変化、実行セッション外を拒否。
- Google Forms/CustomFormの組み込み経路もGatewayを通り、ページロード時には操作しない。
- 複数メッセージを直列化。legacy mapper/enhancerは追加listenerを登録しない。
- popupは現在タブから右だけを対象とし、古いcontentへの追加注入を拒否。
- 保存コード・ord・backupは元ファイルのSHA-256と一致。
- manifestで読み込むページ用スクリプトにGateway外の既知の直接操作パターンがない。

テストHTMLは架空データのみ。実応募先の通信・最終操作、実Chromeプロファイル、実際の拡張登録はテストしていません。外部サイトのJavaScript副作用を全面的に検証した結果ではありません。

再実行方法と残る手動確認は `PHASE01.md` を参照してください。
