# LATIA｜実機REC 2件 独立原因分析・修復案（Claude Code）

- 作業ID: LATIA-REC-INDEPENDENT-ROOTCAUSE-20261108-CLAUDE
- 作成: 2026-11-08 01:19 JST（2026-11-07T16:19Z）
- 対象: `latia-fixture-docs.google.com-f1b955ae.json`（R-G）／`latia-fixture-livepocket.jp-8e027c57.json`（R-L）
- 比較対象: Codex報告 `LATIA_REAL_DEVICE_REC_ROOTCAUSE_20261108_REPORT.md`（＋RESULTS.json／CONTINUATION.md）
- **判定: PARTIAL — 文書レベルの独立分析のみ。ソースとREC原本は未読**

---

## 0. 最初に：この分析の範囲（重要）

この分析は**クラウドのサンドボックス**で実行した。指定作業場所（Mac の `LATIAS-Development/browser/source`）と Downloads の REC 原本 2件には**アクセスできなかった**。

| 対象 | 取得状況 |
|---|---|
| Browser source（`shared/js/field-context-runtime.js`、`limited-fill-dom.js`、`fill-execution-runtime.js`、`BrowserModel.swift` 等） | **未取得**。このセッションに Mac フォルダは共有されていない（`list_computer_folders` = 空） |
| AGENTS.md / CLAUDE.md / shared-memory/WORKSPACE_START_HERE.md（Browser worktree 側） | **未取得**。読めたのは GitHub `lottery-helper` の AGENTS.md（旧 Chrome 拡張用）のみ |
| REC 原本 2件 | **未取得**。Drive 上にも存在しない（検索で確認） |
| Codex 報告 REPORT / RESULTS / CONTINUATION | Drive から読了 |
| `LATIA_CLAUDE_PAGESCOPE_PHASE1_DESIGN.md`（PageScope 設計書） | Drive から読了 |
| GitHub `lottery-helper` | 旧 Chrome 拡張のみ。`PROFILE_FIELD_UNRECOGNIZED`／`staleScope`／`PageScope`／lease／`componentConflict` は**一件も存在しない**（grep 済） |

したがって本書で「事実」と書くものは、すべて **Codex 報告に記載された観測値（二次資料）**であり、私が原本やソースで再確認したものではない。私の独自の貢献は次の3つに限られる。

1. Codex が記録した観測値どうしの**論理的整合性の検証**と、そこから導ける推論
2. Codex が順位付けしなかった仮説の**確率的な優先順位付け**
3. 原因を確定するための**最小の追加診断**と、**条件付きの汎用修正案**

入力値・生 DOM・Cookie・秘密 URL は一切扱っていない（そもそも取得していない）。Browser worktree は編集していない。

### 表記

- **[C事実]** Codex 報告に記載された観測値（未独立検証）
- **[推論]** C事実から論理的に導けること（前提が正しければ成立）
- **[仮説]** 証拠と矛盾しないが未確認。確率は主観的見積り
- **[未確認]** 判断に必要だが入手していない情報

---

## 1. 結論の要約

| 論点 | 私の見解 | 確信度 |
|---|---|---|
| Google：失敗の層は Binding 前の安全投影（policy.authorize）であり、writer ではない | **Codex に賛成** | 高（C事実が一貫） |
| Google：拒否は「正当な保護」より「標準 Google フォーム構造への誤拒否」の可能性が高い | **Codex と異なる**（Codex は両者を同等扱い） | 中〜高（約75%） |
| Google：拒否の主因は意味判定（componentConflict）ではなく**構造的な ARIA 所有判定** | **新規** | 中（約70%） |
| LivePocket：電話の staleScope は LATIA 自身の書込みがきっかけ（自己誘発）または実行期限切れ | **新規**（Codex は未順位付け） | 中（合わせて約75%） |
| LivePocket：メールの cancelled は独立した失敗ではなく stale の連鎖 | Codex の記述と整合 | 高 |
| 「staleScope」という分類自体が writer 例外を覆い隠している可能性 | Codex の指摘を**強く支持**、優先度を上げるべき | 中 |
| Codex の「原因不明なので停止」判断 | 安全面は**妥当**。ただし**証拠の取り方が狭すぎた** | — |

最も重要な追加指摘は2点。

1. **安価でプライバシー上の問題がない再現手段がある。** Google フォームはどのフォームも同じテンプレートで描画される。本人が自分で作ったテスト用フォーム（氏名・フリガナ・電話・住所・メールの5問）で、本物の DOM 構造を秘密 URL や個人情報なしに取得できる。Codex はこの手段を使っていない。
2. **静的確認だけで仮説を1つ潰せる。** LivePocket の実行時間 1407ms が lease や実行期限の定数に近いかどうかは、ソースの定数を1つ見れば分かる。

---

## 2. Codex 分析への賛否

### 2.1 賛成する点

- **Google の失敗層の特定。** 145件すべてが `PROFILE_FIELD_UNRECOGNIZED`／`policy.authorize.rejectedProbe`、正式 Binding 0、Expected Fill 0、19 entries すべて `writeEffect=none`［C事実］。writer や入力イベント以前の拒否であり、「入力イベントを足せば直る」類の修正は無効、という結論は正しい。
- **件数の数え方の注意。** 150 decision は 5欄×30観測の延べ数、19 entries には hidden 等を含む、`applied1` はプロフィール自動入力ではない — いずれも正しい区別。
- **安全検査を無条件に外さない判断。** 欠落・重複 ARIA を一律に無視すると、別の質問や第三者の欄に誤入力する危険がある。同意する。
- **staleScope を無視して続行しない判断。** 同意する。
- **診断不足の指摘**（拒否分岐の内訳、writer 例外の原因が REC に残らない）。正確で、最優先の改善点。

### 2.2 異なる見解・補足

#### (a) 「誤拒否か正当な保護か判別できない」を同等確率として扱った点

Codex は「欠落参照」「重複 ID」の合成ケースが同じ症状を出すことを示し、原因を選べないとして停止した。だが、事前確率は同等ではない。

- R-G の 5欄は**すべて**同じ理由で拒否され、29観測を通じて変わらない［C事実］。
- Google フォームは全フォーム共通の標準テンプレートで描画される［一般知識］。
- 欠落・重複参照の検査は、壊れたページや第三者の部品が混ざったページを守るためのもの。主要プラットフォームの標準テンプレートで、全欄が一様に引っかかるなら、**規則と標準構造のずれ（誤拒否）**と考える方が自然。

**[推論]** 一様な全欄拒否は、ランダムな DOM 異常より、規則の側の系統的なずれを強く示唆する。確信度 約75%。ただし最終判定は §4 の診断で行う。

#### (b) phone／email も拒否されていることの意味（Codex が使っていない証拠）

Codex は fullName／fullKana／fullAddress が派生語彙で `profileKey=null` になり得ると述べた。一方、phone／email は `bindingCandidatePresent=true`［C事実］で、意味上の衝突が起きにくい項目。それでも同じコードで拒否された。

**[推論]** 5欄に共通する原因は意味（語彙・kind の衝突）ではなく、**構造（ARIA 所有関係、または「文脈だけの候補」への格下げ）**の可能性が高い。「電話番号」「メールアドレス」に `POLICY_INFERENCE_KIND_CONFLICT` が起きる理由は想定しにくい。

Codex 報告によれば、`field-context-runtime.js:1399` 付近で componentConflict、`POLICY_INFERENCE_KIND_CONFLICT`、文脈だけの候補の3経路が同じ拒否コードに集約される［C事実］。phone／email の拒否から、意味衝突の経路は優先度が下がる。

#### (c) `labelCount=0` との組合せ

5欄とも `labelCount=0`、出所は ARIA／補助文脈［C事実］。Google フォームは `<label>` を使わず、`aria-labelledby` で質問タイトル要素を参照する構造。

**[仮説 H-G2]** ARIA 参照が「所有の証明」と見なされず、候補が「文脈だけ」に格下げされて拒否された。`<label>` を持たない構造では、ARIA 参照が唯一の正当な所有証拠になる。

#### (d) READY の提示と実行可能な Binding 0 の不整合

R-G に `readiness.presented` が1回あり、fill attempt 0 は Binding 0 の状態で実行された［C事実］。

**[推論・UX 不具合候補]** 実行可能な Binding が 0 なのに READY を出すと、本人はタップしても何も起きない。原因修正とは別に、「実行可能な Binding が1つ以上あるときだけ READY を出す」かを確認すべき（READY が同意・チケット等ほかの項目を根拠に出た可能性もあるので **[未確認]**）。

#### (e) R-G の `latiaTicketChoice` 1件

Google フォームでチケット選択の操作が1件記録されている［C事実］。LivePocket 専用の経路と考えられるため、誤って起動した可能性、あるいは選択肢の自動選択が同じ actor 名で記録されている可能性がある。**[未確認]** 実害は不明だが、§4 の診断で actor の内訳を確認する価値がある。

#### (f) 停止判断の妥当性

安全面では妥当。ただし Codex が挙げた次工程は「診断コードを追加 → 再度実機 REC」で、時間がかかる。§4.1 の静的確認と本人のテスト用フォームを使えば、**新しい Build なしで**仮説の大半を潰せる。

---

## 3. 独自の分析

### 3.1 Google フォーム：PROFILE_FIELD_UNRECOGNIZED

#### 観測の時系列［C事実］

1. observation 0（generation 1）：5欄すべて `READONLY_OR_DISABLED`
2. observation 1〜29：145件すべて `PROFILE_FIELD_UNRECOGNIZED`
3. fill attempt 0 は observation 2 に紐づき、231ms で settle、書込み 0
4. 本人の手動入力（trustedEdit）50件

**[推論]** observation 0 → 1 の変化は、初回描画で disabled だった入力欄が後から有効になる挙動と整合する。拒否理由が `READONLY` から `UNRECOGNIZED` に変わったのは、readonly 判定が優先して先に返っていたため。observation 2 以降も29回連続で同じ拒否なので、**タイミング（描画途中で拾った）は原因ではない**。29回の再観測は本人の手動入力50件に伴うものと考えられる。

#### 仮説の順位

| ID | 仮説 | 根拠 | 見積り |
|---|---|---|---|
| H-G1 | Google フォーム標準構造の ARIA 参照が「欠落」と判定された（例：`aria-describedby` が、遅延描画・非表示のエラー表示や説明要素を参照） | 全欄一様、phone/email も拒否、合成で欠落参照が同じ症状を再現［C事実］ | 約45% |
| H-G2 | `aria-labelledby` の参照先（質問タイトル要素）が、入力欄の所有コンテナの外にある、または複数入力で共有されていると見なされ、「文脈だけの候補」に格下げ | labelCount=0、ARIA 出所［C事実］ | 約30% |
| H-G3 | 重複 ID（モバイル表示で同じ ID の要素が複数描画される等） | 合成で同じ症状を再現［C事実］ | 約15% |
| H-G4 | 意味上の衝突（componentConflict／kind conflict） | phone/email でも起きるのが不自然 | 約10% |

H-G1 と H-G2 に共通する補足：ブラウザの accessible name 計算（W3C accname 仕様）では、**解決できない IDREF は無視**され、エラーにならない。LATIA の検査が欠落参照を一律に拒否する設計なら、ブラウザ自身の挙動より厳しい。これは規則と実サイトのずれの典型的な原因になる。

**[未確認]** 実際の Google フォームの ARIA 構造（参照数・欠落数・重複数・参照先の役割）。§4 のテスト用フォームで取得できる。

### 3.2 LivePocket：staleScope

#### 書込み順と結果［C事実から再構成］

| 順 | fieldId | 結果 |
|---|---|---|
| 1 | 6（候補なし） | bindingUnavailable |
| 2 | 7 fullKana | **applied**、bounded 保持、applicationStateUnverified |
| 3 | 8 fullAddress | unsupported |
| 4 | 9 birthDate | unsupported |
| 5 | 10 phone | **applied → staleScope** |
| 6 | 11 email | cancelled |

attempt 全体 1407ms、terminal = stale［C事実］。fieldId 順が実行順と一致するという前提は **[未確認]**。ただし「電話が applied の後に stale、メールが cancelled」という記録は、**電話の書込み直後に scope の失効が検出され、残りが中止された**ことと整合する。

**[推論]** メールの cancelled は独立した失敗ではなく、stale による attempt 打ち切りの結果。メール欄を個別に直しても解決しない。

#### 仮説の順位

| ID | 仮説 | 根拠 | 見積り |
|---|---|---|---|
| H-L1 | **自己誘発の再描画**：電話欄に LATIA が送った input/change イベントにサイト側が反応し（電話番号の整形・入力チェック・エラー表示の挿入など）、DOM が更新された。その結果、書込み後の live 検査が mutation revision の変化や要素の付け替えを検出した | stale が LATIA 自身の書込みの直後に出ている。カナ欄では起きず電話欄で起きた（電話は入力中チェックを持つことが多い［一般知識］） | 約40% |
| H-L2 | **実行期限・lease の期限切れ**：1407ms は Google の 231ms と比べて長い。lease や clock の期限が 1〜1.5 秒前後なら、5番目の欄の時点で期限を超える | `fill-execution-runtime.js:65` 付近で clock/lease を別途検査［C事実］ | 約35% |
| H-L3 | **writer 例外の誤分類**：電話欄への書込み処理が例外を投げ（maxlength・pattern・type=tel 固有の setter の挙動など）、その後の live 検査も失敗したため staleScope に畳まれた | `limited-fill-dom.js:245` 付近の catch は原例外を結果に出さず staleScope を返す［C事実］ | 約25% |

Codex は `BrowserModel.swift:2738` 付近で「isFilling 中の form change は即座に実行を破棄しない」と述べた［C事実］。ただしこれは Swift 側のスケジューリングの話。**JS 側 writer の書込み後 live 検査**が自己誘発の DOM 変化をどう扱うかは別の層で、Codex の記述からは分からない。H-L1 はまさにこの層の問題。

H-L2 は**定数を1つ確認するだけ**で採否が決まる。最初に確認すべき。

#### PageScope 設計との関係

PageScope 設計書（2026-11-04）は、PageScope を「助言用の照合値であり権限ではない」と定義し、**実行権限（E群）は移行対象外**としている。

**[推論]** fill 実行中の staleScope は PageScope（navigationID／location／displayEpoch／profileEpoch）ではなく、実行側の lease・document generation・pageSession の照合から出ている可能性が高い。PageScope の F6 改修が今回の stale を引き起こしたとは考えにくい。ただし、PageScope 移行後のコードが実機 Build E5957F06… に入っているかは **[未確認]**。

### 3.3 その他の観察

- **LivePocket fieldId 6（候補なし）**：textarea 6件の一部［C事実］。主催者が自由に作る質問（例：氏名を textarea で聞く）だと、ラベル文言が語彙に合わない可能性。**[未確認]**。
- **住所 unsupported**：Codex が挙げた「郵便番号と住所を両方含む質問」の既存フォーマット分岐（`content.js:477〜480`）は、仕様どおりの拒否の可能性がある。誤拒否というより**未対応機能**。改善するなら「質問が郵便番号＋住所を明示的に求め、プロフィールに両方ある場合だけ、決まった形式で結合する」レシピとして、別途設計する。
- **カナの applicationStateUnverified**：値は書けたが、サイト側の内部状態（React/Vue 等の管理値）に反映されたかは未確認。送信時に値が消えるリスクがある。§4 で「書込み 500ms 後の値保持確認」を加える。

---

## 4. 原因確定に必要な追加診断（最小・値なし）

### 4.1 Build 不要の静的確認（最優先。所要 30分以内）

| # | 確認 | 判定できる仮説 |
|---|---|---|
| S1 | `fill-execution-runtime.js` と `limited-fill-dom.js` の lease・clock・deadline の定数値を確認し、1407ms と比較 | H-L2 の採否 |
| S2 | `field-context-runtime.js:1087〜1130` 付近の ARIA 検査が、`aria-labelledby` と `aria-describedby` を**区別せず**欠落参照で拒否しているか | H-G1 の成立可能性 |
| S3 | 同 `:1399` 付近で、ARIA 参照だけで所有を証明した候補が「文脈だけ」に分類される条件 | H-G2 の成立可能性 |
| S4 | `git log -L` や `git blame` で ARIA 所有検査と書込み後 live 検査の導入時期を確認し、Google フォームで実機入力が成功した最後の Build（REG004 系、2026-10-25 前後）と比較 | 回帰か、もともとの未対応か |
| S5 | writer の書込み後 live 検査が mutation revision／要素の接続状態のどちらを見ているか。LATIA 自身が送ったイベントによる変化を除外しているか | H-L1 の成立可能性 |

### 4.2 本人のテスト用 Google フォーム（個人情報・秘密 URL なし）

1. 本人の Google アカウントで新規フォームを作る。質問は「氏名」「フリガナ」「電話番号」「住所」「メールアドレス」の5問（記述式、必須）。
2. Mac の Safari／Chrome でそのフォームを開き、5欄の **ARIA 構造だけ**を取得する（`aria-labelledby`／`aria-describedby` のトークン数、各トークンが解決するか、重複数、参照先の role・tag）。テキストと ID の値は記録しない。
3. 取得した構造を既存 harness（`browser-harness.cjs`／`isolated-world.cjs`）の合成 fixture として再構成し、現行コードで実行する。

これで H-G1〜H-G3 を、実機 REC を取り直さずに判別できる。テスト用フォームは本人の所有物なので、URL・内容とも秘密情報にならない。

### 4.3 製品コードへの最小診断追加（4.1・4.2 で確定しない場合）

すべて**固定 enum と件数のみ**。生 ID・selector・文言・入力値・URL は記録しない。

**Google（Field Context 拒否）**——候補ごとに：

```
ownershipRejection: missingRef | duplicateRef | conflictingRole | thirdParty
                  | contextOnly | kindConflict | componentConflict | none
ariaTokens: { labelledby: {total, resolved, missing, duplicate},
              describedby: {total, resolved, missing, duplicate} }
labelTargetRole: heading | text | hidden | interactive | other   // 参照先の分類のみ
```

**LivePocket（実行失効）**——attempt・field ごとに：

```
staleCause: documentGeneration | location | profile | display | lease | clock
          | elementDisconnected | mutationRevision | writerException | unknown
writerExceptionKind: setterFailed | notConnected | typeMismatch | other   // 原文なし
msSinceAttemptStart, leaseBudgetMs
mutationsAfterWrite: { count, withinTargetContainer: bool, afterLatiaEvent: bool }
retainedAfter500ms: true | false | unchecked
```

既存の `ApplicationSemanticFixtureExport.swift:123〜172` の投影に、この固定分類を追加する形が最小。

---

## 5. 汎用修正案（安全境界を維持）

すべて §4 の診断で該当仮説が確定した場合に限り実施する。仮説の段階で入れない。

### 5.1 Google：ARIA 参照検査を属性の役割で分ける（H-G1 確定時）

| 条件 | 現状（推定） | 修正案 |
|---|---|---|
| `aria-labelledby` が欠落・重複 | 拒否 | **拒否を維持**（名前の出所が曖昧） |
| `aria-describedby` の一部トークンが欠落 | 拒否（推定） | 欠落トークンを文脈から**除外するだけ**。`aria-labelledby` が一意に解決し、所有が証明されていれば拒否しない |
| 重複 ID の各要素が、すべて同じ質問コンテナ内にあるか、同じ文言 | 拒否（推定） | 同じものの複製として扱う。異なる質問コンテナにまたがる重複は**拒否を維持** |
| 第三者文脈・readonly・disabled・既存値あり | 拒否・保護 | **変更しない** |

根拠：ブラウザの accessible name 計算も、解決できない IDREF は無視する（W3C accname）。名前の出所（labelledby）を厳格に、補足説明（describedby）を寛容に扱うのは仕様と整合する。

### 5.2 Google：ARIA で所有を証明した候補を「文脈だけ」に格下げしない（H-G2 確定時）

`<label>` が無く、`aria-labelledby` が一意の要素を参照し、その要素が同じ質問コンテナ（Google フォームでは `role="listitem"` 相当の質問ブロック）の中にあれば、ARIA を所有の証明として扱う。質問コンテナの判定は既存の `ownedProfileComponent`（fieldset/legend、table 等）に「`role` で区切られた質問ブロック」を一般規則として足す形。Google 専用 selector や固定 ID は使わない。

### 5.3 共通：実行可能な Binding が 0 なら READY を出さない（§2.2(d) が確定した場合）

### 5.4 LivePocket：自己誘発の失効から安全に再開する（H-L1 確定時）

staleScope を無視して書き続けるのは**禁止**（この方針は維持）。代わりに：

1. 書込み後の live 検査で、変化の原因を区別する（document generation／location／profile／display が変わったのか、LATIA 自身のイベント直後に対象の質問コンテナ内だけが変わったのか）。
2. 前者なら従来どおり stale で終了。
3. 後者でも**現在の attempt は終了**する（古い handle で書き続けない）。そのうえで、**1回だけ**自動で新しい attempt を始める：新しい観測 → 新しい Binding → 新しい Safety Gateway → 新しい lease。対象はまだ書いていない欄だけ。既存値保護が働くので、書込み済みの電話は上書きされない。
4. 再試行は1回まで。2回目も stale なら停止して理由を表示する。

これなら古い scope には一切書かずに、自己誘発の再描画から回復できる。

### 5.5 LivePocket：期限を「延長」ではなく「欄ごとに更新」（H-L2 確定時）

全体の期限を延ばすのではなく、欄ごとに短い lease を取り直し、その都度 scope を再確認する。1欄あたりの検証が厳しくなるので、安全性は下がらない。

### 5.6 共通：writer 例外を staleScope に畳まない（H-L3 の有無にかかわらず推奨）

`limited-fill-dom.js:245` 付近の catch で、原例外を固定 enum（§4.3 の `writerExceptionKind`）として結果に残す。staleScope と writer 失敗を区別できないと、今後も同じ調査が止まる。これは挙動を変えない診断改善なので、最初に入れてよい。

---

## 6. 回帰試験

### 6.1 修正前に FAIL を確認するもの

| 試験 | 期待（修正前） |
|---|---|
| §4.2 のテスト用 Google フォーム構造を再構成した fixture | 5欄すべて `PROFILE_FIELD_UNRECOGNIZED`（実機 REC と同じ） |
| 電話欄が input イベントで整形・エラー表示を挿入する LivePocket 型 fixture | 電話 applied → staleScope、メール cancelled（実機 REC と同じ） |
| （H-L2 の場合）欄数を増やして実行時間を期限超えにする fixture | 期限超過で stale |

### 6.2 修正後に PASS を確認するもの

- 上記 fixture：Google 5欄が Binding 成立・書込み applied。LivePocket は電話 applied、再試行でメール applied、カナ・電話が上書きされない。

### 6.3 修正後も拒否が維持されること（負例・必須）

| 負例 | 期待 |
|---|---|
| `aria-labelledby` の参照先が欠落 | 拒否 |
| 重複 ID が別々の質問コンテナにまたがる | 拒否 |
| 第三者ラベル混在 | MANUAL_OPERATION |
| readonly／disabled | READONLY_OR_DISABLED |
| 既存値あり | existingValueProtected |
| 書込み中に別 document へ遷移（navigationID 変化） | stale 終了、**再試行しない** |
| 書込み中に Profile 切替 | stale 終了、再試行しない |
| 再試行でも再度 stale | 2回目で停止、理由表示 |
| 送信ボタン・確認ボタン | 一切クリックされない |

### 6.4 既存の正式 gate

正式 shipping regression（Native＋UI）、Node テスト、REG001〜010 offline、REPAIR-01 F5/F6、PageScope 試験。削除・SKIP・条件緩和はしない。

---

## 7. 実機受入の方法

1. **Google（テスト用フォーム）**：§4.2 で作った本人所有のフォームを iPhone の LATIA で開き、中央ボタンを1回タップ。5欄が入力され、送信はされないことを確認。新しい通常 REC を1件取り、5欄が `PROFILE_FIELD_UNRECOGNIZED` でないことを確認する。
2. **Google（実際の抽選フォーム1件）**：同様に確認。送信は本人が判断する。
3. **LivePocket**：電話欄を含む応募ページで中央ボタンを1回タップ。カナ・電話・メールが入力され、電話のあとで止まらないことを確認する。5秒待って、電話・カナの値が消えていないことも確認する。REC の terminal が stale でないこと、または stale → 再試行 → 完了の記録があることを確認する。
4. **負例の実機確認**：入力中に別タブへ移る・Profile を切り替える、といった操作で、LATIA が書込みを止めることを確認する。
5. 本人の判定基準：「自分で入力した欄が上書きされない」「送信ボタンが押されない」「入力されなかった欄に理由が表示される」。

---

## 8. 編集 owner と受渡し

- 本分析では Browser worktree に**一切書き込んでいない**（アクセス自体ができなかった）。
- Codex 報告によれば、Browser lane の現在の担当は Codex（branch `feature/latia-parallel-browser-20261105`、HEAD `c136aff`、dirty entries 289）［C事実］。
- 修正に着手する場合、§4.1 の静的確認は読取だけなので、どちらが行っても衝突しない。製品コードの変更（§4.3 以降）は、Codex から owner を受け渡してから、または Codex に本書を渡して実施する。

### 次工程（推奨順）

1. §4.1 S1〜S5 の静的確認（読取のみ、Build 不要）
2. §4.2 本人のテスト用 Google フォームで ARIA 構造を取得 → harness で再現
3. §5.6 writer 例外の固定分類（挙動を変えない診断改善）
4. 確定した仮説に対応する §5 の修正 → §6 の回帰 → 新 Build → §7 の実機受入

Claude Code に続きを任せる場合は、Mac の Browser source フォルダを Remote Control で共有するか、Mac 上の Claude Code セッションで実行すれば、§4.1 をそのまま進められる。

---

## 9. 事実・推論・未確認の一覧

| 区分 | 内容 |
|---|---|
| C事実（Codex 記載、未独立検証） | R-G：5候補×30観測、初回 READONLY 5件、以後 UNRECOGNIZED 145件、Binding 0、書込み 0、attempt 231ms／R-L：カナ・電話 applied、電話 stale、メール cancelled、住所・DOB unsupported、attempt 1407ms／該当コード行番号 |
| 推論 | 失敗はタイミング由来ではない／phone・email の拒否から意味衝突の経路は優先度が低い／メール cancelled は stale の連鎖／stale は電話の書込み直後に検出／今回の stale は PageScope（助言層）由来ではない可能性が高い |
| 仮説 | H-G1〜G4、H-L1〜L3（§3 の確率は主観的見積り） |
| 未確認 | ソースの実装詳細と定数／実機 Build に含まれるコード／Google フォームの実際の ARIA 構造／fieldId 順＝実行順か／R-G の latiaTicketChoice の正体／READY 提示の根拠 |

## 10. 資料

- Codex REPORT: https://drive.google.com/file/d/1yYW5YLQuue7eqSCiKwenJdOLicyOtsn7/view
- Codex RESULTS: https://drive.google.com/file/d/1Tw1uy6vt8WFyC0oQtwbBnSWTwJ00viYV/view
- Codex CONTINUATION: https://drive.google.com/file/d/1eYhhpqkMGSoFvLOMISw26IPdh1MdBmDy/view
- PageScope 設計: https://drive.google.com/file/d/1e0efiQmsA578rTpmy0L6e-TL6VeVFx2b/view
