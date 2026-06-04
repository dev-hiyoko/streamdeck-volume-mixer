# Stream Deck Volume Mixer

Stream Deck のアクションから、Elgato Volume Controller が起動する `ElgatoAudioControlServer` の WebSocket API を利用する実験用プラグインです。

## 前提

- Windows
- Stream Deck
- Elgato Marketplace の公式 `Volume Controller` プラグイン
- `ElgatoAudioControlServer.exe` が起動していること

## 開発

```powershell
mise install
mise run install
mise run verify
```

または Node.js が直接入っている環境では:

```powershell
npm install
npm run build
```

ビルド後、`fun.hiyoko.volumemixer.sdPlugin` を Stream Deck のプラグインフォルダへ配置するか、Elgato CLI の開発フローで読み込んでください。

このPCで動作確認する場合は、ビルドしてユーザーの Stream Deck Plugins フォルダへコピーできます。

```powershell
.\scripts\install-dev-plugin.ps1
```

