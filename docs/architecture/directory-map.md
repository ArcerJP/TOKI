# Directory map

既存TOKIのアプリ配置を保ち、開発用の情報だけを追加する。分類と正本の判断は [source-of-truth](source-of-truth.md)、構造を変える場合は [extension-policy](extension-policy.md)。

```text
TOKI/
├── AGENTS.md / README.md
├── SOUL.md / IDENTITY.md / USER.md / TOOLS.md / MEMORY.md
├── .agents/skills/        作業手順（5種類）
├── docs/                 正式仕様・設計・ADR
├── knowledge/            raw原本 → wiki派生知識
├── work/                 inbox → notebook → outbox → archive
├── memory/               短期メモ
├── *.html / *.css / *.js  既存アプリのソース
├── database/             DB定義・移行
├── scripts/ / tests/     ビルド・検証
├── icons/ / vendor/      配信素材・固定依存コード
└── .github/              既存公開CI・PRテンプレート
```

「書込」は適用される指示と依頼の範囲内を前提とする。「Git」は公開リポジトリへ載せる既定方針。Git管理とWeb配信は別で、配信は既存許可リストに限定する。

| パス | 目的・分類 | 正本としての範囲 | 読む時点 | 書込 | Git | ライフサイクル |
| --- | --- | --- | --- | --- | --- | --- |
| AGENTS.md | 共通規則・入口 | リポジトリ共通規則 | 開始時 | 規則変更時 | 管理 | 短く維持 |
| README.md | 人向け入口 | 利用・開発の案内 | 初回・操作確認 | 関連変更時 | 管理 | 現状へ同期 |
| SOUL.md / IDENTITY.md | 価値観・役割 | 開発判断・責務 | 判断が必要なとき | 明示方針変更時 | 管理 | 安定情報のみ |
| USER.md / TOOLS.md | 宣言済み希望・環境 | それぞれの分類 | 関係するとき | 根拠確認後 | 管理 | 変更時に確認 |
| USER.private.md / TOOLS.local.md / MEMORY.local.md | 私的補足 | ローカル補足のみ | 必要かつ承認範囲 | 所有者の意図内 | 除外 | 所有者管理 |
| MEMORY.md | 長期参照索引 | 根拠へのリンク | 過去判断の検索 | 必要な持続情報 | 管理 | 短く整理 |
| memory/ | 短期メモ | 一時的な観測 | 関連作業時 | 関連task内 | READMEのみ | 見直し・昇格 |
| .agents/skills/ | 再利用する手順 | Skillごとの手順 | 選択されたとき | 手順変更時 | 管理 | 検証して更新 |
| docs/AGENTS.md | 文書規則 | docs内 | docs編集前 | 規則変更時 | 管理 | 必要最小限 |
| docs/*.md | 機能仕様・運用 | 各仕様の意図 | 対象機能変更時 | 実装と整合確認 | 管理 | 現行仕様へ同期 |
| docs/architecture/ | 構成・正本・拡張 | 情報構造 | 設計・構造変更 | 判断記録とともに | 管理 | 変更理由を維持 |
| docs/decisions/ | ADR | 設計判断と理由 | 判断の確認・変更 | 後継を記録 | 管理 | Superseded等を保持 |
| knowledge/AGENTS.md / SCHEMA.md | 知識の規則・形式 | 取込と記述規則 | 資料整理前 | 規則変更時 | 管理 | 整合性を検証 |
| knowledge/raw/ | 外部資料原本 | 資料としての証拠 | 出典検証時 | 原本を上書きせず追加 | READMEのみ | 版を保持 |
| knowledge/wiki/ | 要約・派生知識 | 出典付きの解釈 | indexから検索 | 出典確認後 | 公開可能な内容のみ | 更新・矛盾・失効を記録 |
| work/AGENTS.md / WORKFLOW.md | 作業規則 | 状態・リスク・承認 | task開始・移動時 | 工程変更時 | 管理 | 規則を一元化 |
| work/_templates/ | 依頼・調査等の雛形 | 形式のみ | task作成時 | 工程と同期 | 管理 | 不要項目は省略可 |
| work/inbox/ | 受付 | 未着手task | 着手前 | task単位 | READMEのみ | notebookへ移動 |
| work/notebook/ | 作業中 | 調査・計画・実施結果 | 開始・再開 | task単位 | READMEのみ | outboxへ移動 |
| work/outbox/ | 確認待ち | 実施済み結果・残件 | 人のレビュー | 修正はnotebookへ戻す | READMEのみ | 確認後archiveへ |
| work/archive/ | 確認済み | 過去taskの記録 | 必要な参照時 | 履歴を尊重 | READMEのみ | 自動削除しない |
| ルートのHTML / CSS / JS、serve.cjs | アプリ実装 | 現在の実装動作 | 対象変更・不具合時 | 依頼範囲 | 管理 | 既存配置を維持 |
| database/ | DB定義・移行 | スキーマの意図・SQL | 認可・保存変更 | 承認・検証が必要 | 管理 | 本番適用と区別 |
| scripts/ | ビルド・配信 | ビルド手順・許可リスト | ビルド変更時 | 検証とともに | 管理 | 配信範囲を維持 |
| tests/ | 自動検証 | 検証された振る舞い | 関連変更時 | 意味のあるテスト | 管理 | 実装と整合 |
| icons/ / vendor/ | 素材・依存成果物 | 配信する固定素材 | 変更時 | 生成手順・ライセンス確認 | 管理 | 生成元と同期 |
| .github/ | 公開CI・PR雛形 | CI設定・レビュー項目 | 公開・PR時 | 範囲確認後 | 管理 | 既存CIを維持 |
| package*.json | 依存・実行定義 | 固定依存・scripts | 環境確認・依存変更 | 必要時のみ | 管理 | lockと同期 |
| .editorconfig / .gitattributes / .gitignore | 形式・Git境界 | 編集形式・除外規則 | 構造変更・差分確認 | 意図を検証 | 管理 | 個別例外を保持 |
| node_modules/ / site/ / tmp/ / output/ | 依存・生成・検証用 | 再生成可能な成果物 | 必要時 | 対象パス確認後 | 除外 | 再生成・安全に整理 |
| .env* / data.local.js | 秘密・ローカル予定 | ローカル設定・データ | 必要かつ承認範囲 | 所有者の意図内 | 除外（例ファイル除く） | 自動転載しない |

一覧は主な既存ファイル群をまとめたもの。新規ディレクトリは責務・正本・公開範囲が定まってから追加する。
