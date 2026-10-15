# ADR-0001: Adopt the workspace structure around existing TOKI

- Status: Accepted
- Date: 2026-10-15
- Decision authority: ユーザーによる、提供したフォルダ設計指示をTOKIにも適用する明示依頼
- Supersedes / Superseded by: なし

## Context

提供された指示は新規KOKOの初期化を想定していた。適用先TOKIには既存アプリ、Git履歴、公開リポジトリ、GitHub Pages、DB運用、利用者がいる。今回の依頼は既存TOKIへの適用であり、空ディレクトリの新規作成ではない。

## Decision

- 5つの情報整理パターンを追加し、アプリのソース・公開URL・Git接続は維持する。
- 空リポジトリを前提とする初期化・停止条件は適用せず、既存状態の確認と追加差分の検証に置き換える。
- AGENTSは短い経路案内、Skillは再利用手順、docsは正式文書、knowledgeは証拠と派生知識、workは作業状態として分離する。
- 原本・作業記録・短期メモ・私的な設定は非公開を既定とする。公開するのは規則・テンプレート・公開可能な知識。
- 公開アプリの許可リスト、既存CI、依存、認証・保存方式はこの構造追加の対象に含めない。

## Alternatives

- アプリ全体を新しいsrc構造へ移動：依頼の情報構造に不要で、配信・PWA・相対パスのリスクを増やすため不採用。
- 全文書をルートAGENTSへ集約：文脈の肥大化と重複管理を招くため不採用。
- taskや原本を全てGit公開：公開リポジトリのため既定では不採用。

## Consequences

既存運用を保ちながら参照先と作業状態が明確になる。自動読込・状態遷移・知識統合は保証されず、規則に従う運用が必要。非公開の作業記録はGit cloneで復元されないため、引き継ぎが必要なら承認された方法で共有する。

検証はリンク、除外規則、Skill形式、既存テスト、配信対象とService Workerのハッシュで行う。取り消す場合はこの追加差分のみを戻し、既存アプリやユーザー変更を巻き戻さない。

## References

- [Five patterns](../architecture/five-patterns.md)
- [Codex runtime](../architecture/codex-runtime.md)
- [Directory map](../architecture/directory-map.md)
