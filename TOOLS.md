# Tooling

確認日：2026-10-15。環境は変わるため、実行時の状態を優先する。

| 用途 | 現在の構成・確認方法 |
| --- | --- |
| ローカル実行 | Node.js / npm、`npm start`。ブラウザー向け静的アプリ |
| 検証 | `npm test`、公開パッケージ生成は `node scripts/prepare-site.cjs` |
| 依存コード生成 | `npm run build`。依存変更が必要なときだけ実行 |
| ソース管理 | Git、既存のoriginとmainを使用。`git status --short --branch` / `git remote -v` |
| GitHub操作 | GitHub CLI。`gh auth status` で状態を確認し、秘密値を出力しない |
| 公開 | 既存のGitHub Pages workflow。URLはREADME参照 |
| 共有・認証 | 既存のSupabase。接続・運用仕様は [会社管理](docs/company-access.md) |
| Google取込 | [Google設定](docs/google-calendar-setup.md) を必要なときに参照 |
| AI規則 | CodexのAGENTS / `.agents/skills`。詳細は [runtime](docs/architecture/codex-runtime.md) |

このファイルはツールの利用許可やログイン状態を保証しない。ネットワーク・権限は実行環境に従う。端末固有パスや私的な設定はGit除外の `TOOLS.local.md`、秘密値は適切な秘密管理先に置く。
