# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> **これは [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode) の個人 fork です**（MIT ライセンス）。独立して維持され、上流より新しい DSH バージョンに追随します。
> 元のコードの著作権は Lixxx1 に帰属します。DeepSeek および上流プロジェクトとは無関係です。
>
> Fork: https://github.com/fallleaves01/dsh-vscode

DeepSeek Harness を、実際にコードを書く場所へ。dsh-vscode は Claude Code や Codex のような右サイドバーを DSH に提供し、プロジェクト・開いているファイル・選択中のコードを最初から理解した状態で動きます。

エディタ、ターミナル、別のチャットウィンドウを行き来することなく、DeepSeek にコードの調査・変更・検証を任せられます。

👋 このプロジェクトを作ったのは、自分自身が DSH をエディタのすぐ隣に置いておきたかったからです。同じように感じる方は、ぜひ試してみてください！使い心地もぜひ聞かせてください。

[English](README.md) | [简体中文](README.zh.md) | **日本語**

[GitHub](https://github.com/fallleaves01/dsh-vscode)

[![CI](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/demo.gif" alt="VS Code のサイドバーで動作する DeepSeek Harness">
</p>

## ✨ 特長

- **VS Code のネイティブデバッガーを自律的に操作。** DeepSeek は現在のプロジェクトの `.vscode/launch.json` からデバッグを開始し、ブレークポイントの管理、ステップ実行、コールスタックやローカル変数の確認を行えます。
- **VS Code の中で公式の DSH をそのまま。** セッション、ストリーミング応答、ツール呼び出し、承認、追加の質問はすべて公式 DSH ランタイム上で動作します。
- **プロジェクトを理解したエディタコンテキスト。** 開いているファイル、選択中のコード、`@file` や `@folder` の参照がプロンプトと一緒に送られます。
- **必要な場所にセッション操作を。** Permission モードと Plan モードの切り替え、Model と Reasoning Effort の選択、実行中タスクの軌道修正ができます。
- **ネイティブなレビューと安全な取り消し。** VS Code の Diff Editor で変更を確認して Keep または Revert を選べます。未保存の変更があるファイルを上書きする前に DSH を停止します。
- **サイドバーから DSH を拡張。** DSH が読み込む Tools、Skills、MCP 連携、Memory、Agent Hooks を検索・管理できます。

## 📦 インストール

まず公式の DeepSeek Harness CLI をインストールします:

```sh
npm install -g @deepseek-ai/dsh
```

次に、用途に合った拡張機能のチャンネルを選びます。

### 公開リリース版

VS Code で**拡張機能**を開き、**DSH Sidebar** を検索して**インストール**を選択します。この fork は VSIX からインストールしてください（下記の開発版ビルドを参照）。

### 最新の開発ビルド

`main` にはすでに入っているものの Marketplace には未公開の機能を試したい場合は、最新の VSIX をビルドしてインストールします:

```sh
git clone https://github.com/fallleaves01/dsh-vscode.git
cd dsh-vscode
pnpm install --frozen-lockfile
pnpm run package
```

VS Code のコマンドパレットから **Extensions: Install from VSIX...** を実行し、`dsh-vscode.vsix` を選択してください。開発ビルドは更新が速い分、安定性は劣る場合があります。更新するには最新の変更を取得して VSIX を再ビルドしてください。インストール済みのバージョンは拡張機能ビューで確認でき、各リリースの変更は `CHANGELOG.md` に記録しています。

VS Code 1.100 以降と Node.js `^22.19` または `>=24` が必要です。

コミュニティ製のランタイムプラグインをインストールする場合は、`pnpm` が PATH に通っている必要があります。

## 🚀 使い方

1. 信頼済みのプロジェクトフォルダを VS Code で開きます。
2. 右サイドバーで **DeepSeek** を選択します。表示されていない場合は **その他のビュー** から探してください。
3. 鍵アイコンのボタンから `DEEPSEEK_API_KEY` を設定します。
4. Permission モード、Model、Reasoning Effort を選んで作業を開始します。Permission モードと Plan モードの切り替えは Shield メニュー、DSH 公式のコマンドは `/`、ファイルやフォルダの追加は `@` から行えます。
5. サイドバーのタイトルにあるプラグインボタンから、コミュニティ製ランタイムプラグインの検索・インストール・確認・削除ができます。

### 自律デバッグ

VS Code の設定で **DeepSeek Harness: Autonomous Debugging** を有効にし、`.vscode/launch.json` にデバッグ構成を追加します。

DeepSeek はサイドバーからデバッガーを起動し、ブレークポイントの設定、ステップ実行、実行時の値の確認、コードの修正、結果の検証まで行えるようになります。

DeepSeek Harness `0.2.0-rc.2` を対象とし、`0.1.7-rc.1`/`0.1.7-rc.2` ともワイヤ互換です（上流 v0.0.5 は `0.1.5-rc.1` 対象）。

💬 使いにくい点や「次はこれが欲しい」というアイデアがあれば、[Issue を立ててください](https://github.com/fallleaves01/dsh-vscode/issues)。いただいたフィードバックはすべて読んでいます。PR も歓迎です。

## License

[MIT](LICENSE)
