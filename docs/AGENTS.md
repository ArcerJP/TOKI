# Documentation guidance

- docsは正式な仕様・設計・運用・判断の置き場。進行中の調査や会話の転記はworkへ。
- 既存のcompany-access / google-calendar-setup / mobile-ui-designを尊重し、同じ仕様を別文書へ複製しない。
- 設計の索引は [architecture/directory-map.md](architecture/directory-map.md)、正本は [source-of-truth](architecture/source-of-truth.md)。
- 仕様と実装の食い違いは事実として記録し、どちらを変更するか判断する。無断で実装を仕様と見なさない。
- 恒久的な設計判断は [ADR](decisions/README.md)。既存判断を消さず、変更理由と後継を残す。
- 参照URL・確認日・適用範囲を明記する。未検証の内容は未検証と書く。
- 公開リポジトリ向け文書。個人情報、認証情報、非公開のtaskや原本を転載しない。
- 構造変更時はdirectory-map、source-of-truth、必要なREADMEだけ更新。文章を重複させない。
