// 動作確認: node tests/case-row.test.js
// Code.gs の appendCaseRow を、案件基本情報を真似た偽のシートに対して実行する。
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function fakeSheet(headers, rows, { formulas = {}, rejectCol = 0, maxRows = 1000 } = {}) {
  const cells = [headers, ...rows]; // cells[r-1][c-1]
  const formulaCells = {};
  const get = (r, c) => (cells[r - 1] || [])[c - 1] ?? '';
  const set = (r, c, v) => { while (cells.length < r) cells.push([]); cells[r - 1][c - 1] = v; };
  const range = (r, c, h = 1, w = 1) => ({
    getValue: () => get(r, c),
    getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => get(r + i, c + j))),
    getFormulasR1C1: () => [Array.from({ length: w }, (_, j) => formulas[`${r},${c + j}`] || '')],
    getNextDataCell: () => { let x = r; while (x > 1 && get(x, c) === '') x--; return { getRow: () => x }; },
    setFormulaR1C1: f => { formulaCells[`${r},${c}`] = f; },
    setValue: v => { if (c === rejectCol) throw new Error('violates data validation'); set(r, c, v); },
  });
  return {
    cells, formulaCells,
    getLastColumn: () => headers.length, getMaxRows: () => maxRows,
    getRange: range, insertRowAfter: () => { maxRows++; },
  };
}

function load(files = {}) {
  const ctx = {
    SpreadsheetApp: {}, console,
    Utilities: { formatDate: () => '2026/11/10', newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString('latin1') }) },
    DriveApp: { getFileById: id => ({
      getBlob: () => ({ getBytes: () => Buffer.from(files[id], 'latin1') }),
      setTrashed: () => trashed.push(id),
    }) },
    ScriptApp: { getOAuthToken: () => 'token' },
    // Range 指定の先頭バイト読み出し。Apps Script と同じく符号付きバイトの配列を返す
    UrlFetchApp: { fetch: (url, opts) => {
      const id = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
      const end = Number(opts.headers.Range.split('-')[1]);
      const bytes = [...Buffer.from(files[id] || '', 'latin1').subarray(0, end + 1)].map(b => (b > 127 ? b - 256 : b));
      return { getResponseCode: () => (id in files ? 206 : 404), getContent: () => bytes };
    } },
  };
  const trashed = [];
  ctx.trashed = trashed;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../Code.gs', 'utf8'), ctx);
  return ctx;
}

function run(sheet, data) {
  const ctx = load();
  ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => sheet }), Direction: { UP: 'up' } };
  const props = { getProperty: k => ({ CASE_SHEET_ID: 'X' })[k] || null };
  return ctx.appendCaseRow(props, data, 'https://drive.google.com/drive/folders/F');
}

const HEADERS = ['案件番号', 'ステータス', '顧客名', '顧客支店名', '顧客住所（自動）', '顧客電話番号（自動）', '案件名', '案件住所',
  '取引種別', '営業担当', '床下暖房種別', '備考', '契約金額（税抜）', '契約金額（税込）', '契約日', '着工予定日', '完工予定日'];
const DATA = { company: '=テスト工務店', branch: '大阪支店', contact: '山田', email: 'y@example.com', projectName: '山田様邸',
  projectAddress: '大阪市1-2-3', heating: 'AC', start: '2026-12-01', finish: '2026-12-20', note: '至急' };

// 1. 通常: ヘッダー名どおりの列に入り、自動列は数式をコピーする
let s = fakeSheet(HEADERS, [['B25-001', '受注', 'A社', '', '', '', '既存案件']], { formulas: { '2,5': '=VLOOKUP(R[0]C[-2],x,2,0)' } });
assert.strictEqual(run(s, DATA), 'row 3');
const row = s.cells[2];
const col = name => HEADERS.indexOf(name);
assert.strictEqual(row[col('顧客名')], "'=テスト工務店", 'formula injection is escaped');
assert.strictEqual(row[col('顧客支店名')], '大阪支店');
assert.strictEqual(row[col('案件名')], '山田様邸');
assert.strictEqual(row[col('床下暖房種別')], 'AC');
assert.ok(row[col('着工予定日')] instanceof Date || Object.prototype.toString.call(row[col('着工予定日')]) === '[object Date]');
assert.strictEqual(row[col('完工予定日')], undefined, '完工予定日 is no longer written');
assert.ok(row[col('備考')].includes('担当：山田（y@example.com）') && row[col('備考')].endsWith('至急'));
assert.strictEqual(row[col('顧客住所（自動）')], undefined, 'auto column gets no value');
assert.strictEqual(s.formulaCells['3,5'], '=VLOOKUP(R[0]C[-2],x,2,0)', 'auto column formula is copied');

// 2. 列の並べ替え: 案件名と顧客名が入れ替わっても正しい列に入る
const swapped = [...HEADERS]; [swapped[2], swapped[6]] = [swapped[6], swapped[2]];
s = fakeSheet(swapped, []);
run(s, DATA);
assert.strictEqual(s.cells[1][swapped.indexOf('案件名')], '山田様邸');
assert.strictEqual(s.cells[1][swapped.indexOf('顧客名')], "'=テスト工務店");

// 3. 入力規則で拒否された値と、ヘッダーがない項目は備考に回る
const noBranch = HEADERS.filter(h => h !== '顧客支店名');
s = fakeSheet(noBranch, [], { rejectCol: noBranch.indexOf('顧客名') + 1 });
run(s, DATA);
const memo = s.cells[1][noBranch.indexOf('備考')];
assert.ok(memo.includes('顧客名：=テスト工務店') && memo.includes('顧客支店名：大阪支店'), memo);

// 4. 備考列がなければ失敗として扱う(通知メールで手入力を促す)
assert.throws(() => run(fakeSheet(HEADERS.filter(h => h !== '備考'), []), DATA), /備考/);

// 5. PDF の危険な要素の検出(#xx で隠した名前も見つける。正常な PDF は何も出さない)
const pdfs = {
  clean: '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >> endobj',
  js: '%PDF-1.7\n1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj',
  hidden: '%PDF-1.7\n1 0 obj << /S /L#61unch /F (cmd.exe) >> endobj',
  embedded: '%PDF-1.7\n<< /Names << /EmbeddedFiles 4 0 R >> >>',
  jww: 'JwwData.\xc8\x02\x00\x00',
  fakeJww: 'MZ\x90\x00 this is an exe',
  fakePdf: 'MZ\x90\x00 this is an exe',
};
const scan = load(pdfs);
assert.deepStrictEqual([...scan.findRiskyPdfNames(Buffer.from(pdfs.clean, 'latin1'))], []);
assert.deepStrictEqual([...scan.findRiskyPdfNames(Buffer.from(pdfs.js, 'latin1'))], ['/JavaScript', '/JS']);
assert.deepStrictEqual([...scan.findRiskyPdfNames(Buffer.from(pdfs.hidden, 'latin1'))], ['/Launch']);
const warnings = scan.inspectUploadedFiles([
  { id: 'clean', name: 'a.pdf', size: 10 }, { id: 'embedded', name: 'b.pdf', size: 10 },
  { id: 'jww', name: 'c.jww', size: 10 }, { id: 'js', name: 'd.pdf', size: 200 * 1024 * 1024 },
  { id: 'fakeJww', name: 'e.jww', size: 10 }, { id: 'fakePdf', name: 'f.PDF', size: 10 },
]);
assert.deepStrictEqual([...warnings], [
  'b.pdf：/EmbeddedFiles',
  'd.pdf：未検査（合計サイズの上限を超えたため）',
  'e.jww：拡張子と中身の形式が一致しないため、ゴミ箱に移しました',
  'f.PDF：拡張子と中身の形式が一致しないため、ゴミ箱に移しました',
]);
assert.deepStrictEqual([...scan.trashed], ['fakeJww', 'fakePdf'], 'only disguised files are trashed');

// 6. 警告は案件基本情報の備考にも残る
s = fakeSheet(HEADERS, []);
run(s, { ...DATA, warnings: ['b.pdf：/EmbeddedFiles'] });
assert.ok(s.cells[1][col('備考')].includes('【要注意】b.pdf：/EmbeddedFiles'));

console.log('ok: case row tests passed');
