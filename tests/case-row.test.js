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

function run(sheet, data) {
  const ctx = {
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), Direction: { UP: 'up' } },
    Utilities: { formatDate: () => '2026/11/10' },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../Code.gs', 'utf8'), ctx);
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

console.log('ok: case row tests passed');
