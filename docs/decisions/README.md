# Architecture decisions

恒久的な設計判断と理由を残す。taskの進捗やログ全文は置かない。

- 命名：`ADR-NNNN-short-kebab-title.md`。番号は重複を確認して採番。
- 状態：Proposed / Accepted / Superseded / Deprecated。
- Acceptedは人の判断・依頼などの根拠を明記し、AIだけで承認を捏造しない。
- 決定変更は新しいADRを追加し、旧ADRへ後継リンクとSupersededを記録。過去の理由を消さない。
- 使用開始は [テンプレート](ADR-0000-template.md)。公開できる内容だけ記録する。

| ADR | 状態 | 内容 |
| --- | --- | --- |
| [0001](ADR-0001-workspace-adoption.md) | Superseded（ソース配置部分） | 既存TOKIにワークスペース情報構造を追加 |
| [0002](ADR-0002-source-layout.md) | Accepted | src/publicへ整理し、公開URL・動作を維持 |
