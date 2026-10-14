# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> **これは [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode) の個人 fork です**（MIT ライセンス）。独立して維持され、上流より新しい DSH バージョンに追随します。
> 元のコードの著作権は Lixxx1 に帰属します。DeepSeek および上流プロジェクトとは無関係です。
>
> Fork: https://github.com/fallleaves01/dsh-vscode

DSH Sidebar は公式 DeepSeek Harness ランタイムを VS Code に統合します。プロジェクト別の会話、独立したサブエージェント詳細、明示的なファイル参照、ネイティブの差分レビューを提供します。

現在のソースバージョンは **0.1.5** です。変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。元の拡張機能は [Lixxx1](https://github.com/Lixxx1) が作成しました。

[English](README.md) | [简体中文](README.zh.md) | **日本語**

[GitHub](https://github.com/fallleaves01/dsh-vscode)

[![CI](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/demo.gif" alt="VS Code のサイドバーで動作する DeepSeek Harness">
</p>

## ✨ 特長

- **会話と履歴。** 公式 DSH ランタイムで応答を受信し、ツール呼び出し、承認、質問、過去のメッセージを確認できます。
- **会話ディレクトリ。** 一覧の入力欄からタスクを開始し、最近の会話とアーカイブを検索、名前変更、アーカイブ、復元できます。アーカイブ直後は Undo を利用できます。上部の一覧はメイン会話を切り替えます。
- **独立したサブエージェント詳細。** Tasks から子タスクを開き、メイン会話の隣で状態、履歴、ツール出力、実行時間、トークン数を確認できます。承認、質問への回答、停止に対応し、親エージェントが許可する場合は Queue／Steer を送信できます。単発タスクの入力欄は読み取り専用です。
- **バックグラウンドタスクとサービス。** 長さを制限したプロセス出力、Goal の状態とラウンド上限、Schedule の通知と配信履歴、Workflow の段階とジョブログを表示します。利用可否はランタイムのサービスによります。履歴検索を有効にすると本文を検索できます。
- **明示的なファイル参照。** `+` からファイルやフォルダーを追加し、`×` で個別に削除できます。`@` と **Add Selection to Chat** にも対応します。現在のファイルと選択範囲は任意の候補です。リソースのドロップと画像の貼り付けにも対応します。
- **会話設定とキュー。** エージェント構成、Permission、Plan、Model、Reasoning Effort を選択します。追加メッセージのキュー、実行中タスクへの Steer、保留中コマンドの確認と削除に対応します。
- **コンパクトな差分レビュー。** ファイル数と追加・削除行数を折りたたんで表示し、展開または Review から VS Code Diff Editor を開きます。Keep／Revert はターン別のスナップショットを使用し、元の会話とプロジェクトを検証します。取り消しの確認後にも対象を再検証します。
- **DeepSeek 認証。** API キーまたはブラウザー経由のログインを使用し、状態と残高を確認してログアウトできます。リモートログインは VS Code のポート転送を使用します。
- **プラグインと設定。** Tools、Skills、MCP、Memory、Agent Hooks を管理します。プラグイン管理から、DSH が公開する設定名前空間の選択と編集もできます。
- **ランタイムの復旧。** 管理対象ランタイムのウィンドウ間共有、再接続、会話の占有診断、識別済みの残存管理プロセスの終了に対応します。保存した外部ランタイムには接続のみを行います。
- **デバッグとキーボード操作。** `.vscode/launch.json` の自律デバッグでブレークポイント、ステップ実行、スタック、変数を操作できます。`Cmd/Ctrl+Alt+D` は会話を開き、`Cmd/Ctrl+Alt+L` は選択範囲を追加し、`Cmd/Ctrl+Alt+F` はファイル修正を要求します。会話とタスク詳細はダーク、ライト、高コントラストに対応します。

## 📦 インストール

まず公式の DeepSeek Harness CLI をインストールします:

```sh
npm install -g @deepseek-ai/dsh
```

DSH は拡張機能を実行するホストにインストールしてください。Remote SSH ではリモートホストです。

### 公開リリース版

[GitHub Releases](https://github.com/fallleaves01/dsh-vscode/releases) から対象バージョンの `.vsix` をダウンロードし、VS Code の **Extensions: Install from VSIX...** で選択してください。この fork の拡張 ID は `fallleaves01.dsh-sidebar` です。

公開済みのファイルは `main` より古い場合があります。必要なバージョンが未添付の場合は以下の手順でビルドしてください。上流の Marketplace 拡張機能は独自の発行者とリリース日程を使用します。

### 最新の開発ビルド

`package.json` で指定した pnpm バージョンで現在のソースをビルドします:

```sh
git clone https://github.com/fallleaves01/dsh-vscode.git
cd dsh-vscode
pnpm install --frozen-lockfile
pnpm run package
```

**Extensions: Install from VSIX...** を実行し、生成された `dsh-vscode.vsix` を選択してください。ソースビルドを更新するには変更を取得して再ビルドします。インストール済みのバージョンは拡張機能ビューで確認できます。

VS Code 1.100 以降と Node.js `^22.19.0` または `>=24.0.0` が必要です。

コミュニティ製のランタイムプラグインをインストールする場合は、`pnpm` が PATH に通っている必要があります。

## 🚀 使い方

1. 信頼済みのプロジェクトフォルダを VS Code で開きます。
2. 右サイドバーで **DeepSeek** を選択します。表示されていない場合は **その他のビュー** から探してください。
3. 鍵ボタンから `DEEPSEEK_API_KEY` を設定するか、**DeepSeek Harness: Sign In to DeepSeek Account** を実行します。
4. 会話ディレクトリからタスクを開始し、モデルと推論強度、ファイル参照を選んで送信します。会話設定メニューで Permission、Plan、エージェント構成を選択し、`/` で DSH コマンドを開きます。
5. Tasks からサブエージェント詳細を開き、変更概要から差分を確認します。ディレクトリでは検索、名前変更、アーカイブ、復元を行えます。
6. タイトルのプラグインボタンからプラグインを管理し、既存のランタイム設定選択画面を開きます。

### 任意のタスクサービス

**DeepSeek Harness: Configure Task Services** から `enableHistorySearch` と `enableSchedule` を設定します。標準の管理対象 Web ランタイムで本文検索と Schedule を有効にします。反映には再起動が必要です。カスタムまたは外部ランタイムでは、そのプロファイルで対応サービスを提供する必要があります。

### 自律デバッグ

VS Code の設定で **DeepSeek Harness: Autonomous Debugging** を有効にし、`.vscode/launch.json` にデバッグ構成を追加します。

DeepSeek はサイドバーからデバッガーを起動し、ブレークポイントの設定、ステップ実行、実行時の値の確認、コードの修正、結果の検証まで行えるようになります。

DeepSeek Harness `0.2.0-rc.2` で検証済みです。基本プロトコルは `0.1.7-rc.1` と `0.1.7-rc.2` にも対応します。任意のサービスは実際のランタイムバージョンとプロファイルに依存します。

## プライバシーと検証

鍵ボタンで設定した API キーは VS Code SecretStorage に保存します。保存したランタイム起動 URL は所有者のみがアクセスできるローカルファイルに保存し、同期しません。ファイル参照は明示的に追加します。プロンプトと選択したコンテキストは、設定したモデルサービスへ送信される場合があります。

[0.1.5 のレビュー](docs/RELEASE-REVIEW-2026-10-15.md) は修正、プライバシー確認、テスト範囲、検証上の制限を記録します。開発時の `braces` にはバージョンに基づく警告が残ります。ローカルの深さ制限パッチは報告済みの再帰問題に対応し、この依存関係とパッチは VSIX に含めません。

不具合や機能の提案は [GitHub Issues](https://github.com/fallleaves01/dsh-vscode/issues) に報告してください。

## License

[MIT](LICENSE)
