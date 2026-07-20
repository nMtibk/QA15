#!/usr/bin/env node
/**
 * encrypt.js
 * ----------
 * 元になる平文の問題データ（JSON配列）をパスワードで暗号化し、
 * アプリ本体が読み込む questions.json（暗号化済み）を生成する。
 *
 * 使い方:
 *   node tools/encrypt.js <パスワード> [入力json] [出力json]
 *
 * 例:
 *   node tools/encrypt.js "MyNewPassword123" ../questions.plain.json ../questions.json
 *
 * ブラウザ側の Web Crypto API (PBKDF2 + AES-GCM) と完全互換の形式で出力する。
 * パスワードを変更したいときは、新しいパスワードでこのスクリプトを再実行し、
 * 生成された questions.json（リポジトリ直下）を差し替えて GitHub Pages に再デプロイするだけでよい。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ITERATIONS = 250000; // PBKDF2 反復回数（大きいほど総当たり攻撃に強いが起動が少し遅くなる）

function main() {
  const [, , password, inputPathArg, outputPathArg] = process.argv;

  if (!password) {
    console.error('エラー: パスワードを指定してください。');
    console.error('使い方: node tools/encrypt.js <パスワード> [入力json] [出力json]');
    process.exit(1);
  }

  const inputPath = inputPathArg || path.join(__dirname, '..', '..', 'questions.plain.json');
  const outputPath = outputPathArg || path.join(__dirname, '..', 'questions.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`エラー: 入力ファイルが見つかりません: ${inputPath}`);
    process.exit(1);
  }

  const plaintext = fs.readFileSync(inputPath, 'utf-8');

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // AES-GCM 標準の IV 長

  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256'); // 256bit key

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  // Web Crypto の subtle.decrypt は「暗号文 + 認証タグ」を連結した形を期待するため連結する
  const ciphertextWithTag = Buffer.concat([encrypted, authTag]);

  const output = {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertextWithTag.toString('base64'),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output));

  console.log('暗号化が完了しました。');
  console.log(`  入力: ${inputPath} (${plaintext.length} 文字)`);
  console.log(`  出力: ${outputPath}`);
  console.log('');
  console.log('この出力ファイルには問題データは平文で含まれていません。');
  console.log('正しいパスワードでのみブラウザ側で復号できます。');
}

main();
