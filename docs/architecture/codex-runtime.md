# Codex runtime and workspace conventions

確認日：2026-10-15。Codex CLI / IDEでのリポジトリ運用を対象とする。将来の仕様変更は公式資料で再確認する。

## Codexが提供する仕組み

公式 [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) によると、実行開始時にグローバル指示からプロジェクトルート、現在の作業ディレクトリまでの指示を組み立てる。

- 各ディレクトリでは `AGENTS.override.md` を優先し、なければ `AGENTS.md`、設定されたfallback名を調べる。採用はそのディレクトリにつき1ファイル。
- ルートで開始した実行が、すべての下位AGENTSを最初から読むとは限らない。このリポジトリでは、対象領域を編集する前にそのAGENTSを明示して読む。
- プロジェクト指示の既定上限は32KiB。ルートAGENTSは150行以内を目安に保ち、詳細は参照先へ置く。
- グローバル設定やsandboxはこのリポジトリ文書で上書きしない。指示ファイルの変更が現在の会話へ自動反映済みとは主張しない。

公式 [Skills](https://learn.chatgpt.com/docs/build-skills) に従い、リポジトリのSkillを `.agents/skills/<name>/SKILL.md` に置く。

- 現在の作業ディレクトリからルートまでの `.agents/skills` が探索対象。`name` と `description` が選択に使われ、必要なSkill本文を読む。
- 明示的な呼出しと、依頼に合うSkillの選択がある。無関係なSkillを毎回読む必要はない。
- 各SkillにはYAML frontmatterのname/descriptionを設定する。追加リソースは必要になった場合だけ作る。
- 変更が一覧に現れない場合は新しい実行・セッションで確認する。ファイル形式の検証と、実際の実行環境での発見確認は別の検証。

## TOKI側で定めた運用

| 分類 | ファイル・仕組み | 読込・動作 |
| --- | --- | --- |
| Codexの指示 | AGENTS.md、必要な下位AGENTS | 上記の探索規則＋対象領域への明示参照 |
| CodexのSkill | `.agents/skills/*/SKILL.md` | タスクに合うSkillを選ぶ |
| 文脈の整理 | SOUL / IDENTITY / USER / TOOLS / MEMORY | 必要時に参照。ファイル名だけで自動読込されない |
| 作業管理 | workとテンプレート | エージェントまたは人が状態を更新。自動schedulerなし |
| 知識の整理 | knowledge/raw、wiki | 出典を確認して手動・承認済み作業で統合 |
| 公開対象 | `scripts/pwa-assets.cjs` | 既存の静的アプリ許可リストのみ |

グローバルconfigの変更、未知のフック、全ファイル常時読込、他ツール用の互換設定は導入していない。別ツールへの移行時は [portability](portability.md) を適用する。
