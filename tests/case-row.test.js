// 動作確認: node tests/case-row.test.js
// Code.gs の appendCaseRow を、案件基本情報を真似た偽のシートに対して実行する。
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function fakeSheet(headers, rows, { formulas = {}, rejectCol = 0, maxRows = 1000, lists = {} } = {}) {
  const cells = [headers, ...rows]; // cells[r-1][c-1]
  const formulaCells = {};
  const formats = {};
  const pending = [];
  const get = (r, c) => (cells[r - 1] || [])[c - 1] ?? '';
  const set = (r, c, v) => { while (cells.length < r) cells.push([]); cells[r - 1][c - 1] = v; };
  const range = (r, c, h = 1, w = 1) => ({
    _r: r,
    setNumberFormat: f => { formats[`${r},${c}`] = f; },
    copyTo: target => { cells[target._r - 1] = [...(cells[r - 1] || [])]; },
    clearContent: () => { cells[r - 1] = []; },
    getValue: () => get(r, c),
    getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => get(r + i, c + j))),
    getFormulasR1C1: () => [Array.from({ length: w }, (_, j) => formulas[`${r},${c + j}`] || '')],
    getNextDataCell: () => { let x = r; while (x > 1 && get(x, c) === '') x--; return { getRow: () => x }; },
    setFormulaR1C1: f => { formulaCells[`${r},${c}`] = f; },
    getDataValidation: () => { const list = lists[c] || (c === rejectCol ? ['A社'] : null);
      return list ? { getAllowInvalid: () => false, getCriteriaType: () => 'list', getCriteriaValues: () => [list] } : null; },
    setValue: v => { const list = lists[c] || (c === rejectCol ? ['A社'] : null); if (list && !list.includes(v)) pending.push(`${r},${c}`); set(r, c, v); }, // 実物は後で反映するときに失敗する
  });
  return {
    cells, formulaCells, formats, pending,
    getLastColumn: () => headers.length, getMaxRows: () => maxRows, getLastRow: () => cells.length,
    getRange: range, insertRowAfter: () => { maxRows++; },
    getParent: () => ({ getSpreadsheetTimeZone: () => 'America/Los_Angeles' }),
    insertRowBefore: r => { cells.splice(r - 1, 0, []); maxRows++; },
  };
}

function load(files = {}) {
  const ctx = {
    SpreadsheetApp: {}, console,
    Utilities: { formatDate: (d, tz, f) => ({ yyMM: '2611', 'yyyy-MM-dd': '2026-11-11' })[f] || '2026/11/11',
      // シートのタイムゾーンで暦日を日付にする(呼ばれ方を記録する)
      parseDate: (str, tz) => { parsed.push(str + '@' + tz); const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }, newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString('latin1') }) },
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
  const parsed = [];
  ctx.trashed = trashed;
  ctx.parsed = parsed;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../Code.gs', 'utf8'), ctx);
  return ctx;
}

const CRITERIA = { VALUE_IN_LIST: 'list', VALUE_IN_RANGE: 'range' };
function run(sheet, data) {
  const ctx = load();
  ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => sheet }), Direction: { UP: 'up' }, DataValidationCriteria: CRITERIA };
  const props = { getProperty: k => ({ CASE_SHEET_ID: 'X' })[k] || null };
  return ctx.appendCaseRow(props, data, 'https://drive.google.com/drive/folders/F');
}

const HEADERS = ['案件番号', 'ステータス', '顧客名', '顧客支店名', '顧客住所（自動）', '顧客電話番号（自動）', '案件名', '案件住所',
  '取引種別', '営業担当', '床下暖房種別', '備考', '契約金額（税抜）', '契約金額（税込）', '契約日', '着工予定日', '完工予定日'];
const DATA = { company: '=テスト工務店', branch: '大阪支店', contact: '山田', email: 'y@example.com', projectName: '山田様邸',
  projectAddress: '大阪市1-2-3', heating: 'AC', start: '2026-12-01', finish: '2026-12-20', deadline: '2026-11-20', rush: '翌営業日（+3万円）', note: '至急' };

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
assert.ok(Object.prototype.toString.call(row[col('完工予定日')]) === '[object Date]', '完工予定日 is written as a date');
assert.strictEqual(row[col('備考')], '至急', '案件基本情報の備考は、入力された備考だけ(連絡先・リンク・希望納期は書かない)');
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
assert.deepStrictEqual([...s.pending], [], 'a value outside the dropdown is never written to the cell');
// 株式会社・㈱などの違いはプルダウンの表記に合わせて書く
s = fakeSheet(HEADERS, [], { rejectCol: HEADERS.indexOf('顧客名') + 1 });
run(s, { ...DATA, company: '株式会社　A社' });
assert.strictEqual(s.cells[1][HEADERS.indexOf('顧客名')], 'A社');
assert.ok(!s.cells[1][HEADERS.indexOf('備考')].includes('顧客名：'));

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

// 7. Script Properties には ID の代わりに URL を貼ってもよい
const props = v => ({ getProperty: () => v });
const ids = load();
assert.strictEqual(ids.idProperty(props('https://drive.google.com/drive/folders/0AAMhUhWwqKARUk9PVA'), 'X'), '0AAMhUhWwqKARUk9PVA');
assert.strictEqual(ids.idProperty(props('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjK_lm-no?usp=sharing'), 'X'), '1AbCdEfGhIjK_lm-no');
assert.strictEqual(ids.idProperty(props('https://docs.google.com/spreadsheets/d/19ZOo675Q2fELHln_wrCCKM1cYgfe1E-VWF-Td-xKgBc/edit?gid=0#gid=0'), 'X'),
  '19ZOo675Q2fELHln_wrCCKM1cYgfe1E-VWF-Td-xKgBc');
assert.strictEqual(ids.idProperty(props(' 19ZOo675Q2fELHln_wrCCKM1cYgfe1E-VWF-Td-xKgBc '), 'X'), '19ZOo675Q2fELHln_wrCCKM1cYgfe1E-VWF-Td-xKgBc');
assert.strictEqual(ids.idProperty(props(null), 'X'), '');

// 8. 設計用・顧客管理: 実際のタブの見出し(豊栄建設は A1 が空欄)
const DESIGN = ['支店名', '顧客名', '作図担当', '依頼者', 'PDF依頼日', '依頼者2', 'CAD依頼日', '設計者', '図面納品日', '引渡日',
  '設計料(税抜)', '特許料(税抜)', '備考', 'ステータス', '案件番号'];
const book = {
  '豊栄建設': fakeSheet(['', '作図担当', '依頼者', 'PDF依頼日', '依頼者2', 'CAD依頼日', '設計者', '図面納品日', '引渡日', '設計料(税抜)', '特許料(税抜)', '備考', 'ステータス', '案件番号'],
    [['既存A', '安田', '佐藤', '25/01/27', '', '', '', '', '', '100,000', '', '', '完工済', ''],
     ['既存B', '木村', '鈴木', '25/12/15', '', '', '', '', '', '80,000', '', '平屋', '完工済', 'B2611-004']]),
  'ロゴスホーム': fakeSheet(['支店', '顧客名', '作図担当', '依頼者', 'PDF依頼日', '依頼者2', 'CAD依頼日', '設計者', '図面納品日', '引渡日', '設計料(税抜)', '特許料(税抜)', '備考', 'ステータス', '案件番号', '床下暖房種別'],
    [['旭川', '既存C', '傳福', '', '', '', '', '', '', '', '85,000', '', '', '完工済', 'B2611-009', 'AC']]),
  '生杉建設': fakeSheet(DESIGN, []), '竹内建設': fakeSheet(DESIGN, []),
  'その他': fakeSheet(['会社名', ...DESIGN], [['リノア', '', '既存D', '傳福', '', '', '', '', '', '', '', '', '', '', '完工済', 'B2607-027']]),
};
const caseSheet = fakeSheet(HEADERS, [['B2611-002', '', 'A社']]);
let lastParsed = [];
function runDesign(data) {
  const ctx = load();
  lastParsed = ctx.parsed;
  ctx.SpreadsheetApp = { openById: id => ({ getSheetByName: name => (id === 'D' ? book[name] : caseSheet) }), Direction: { UP: 'up' }, DataValidationCriteria: CRITERIA };
  const props = { getProperty: k => ({ CASE_SHEET_ID: 'C', DESIGN_SHEET_ID: 'D' })[k] || null };
  data.caseNumber = ctx.nextCaseNumber([ctx.openCaseSheet(props), ...ctx.openDesignTabs(props)]);
  return [ctx.appendCaseRow(props, data, 'https://drive.google.com/drive/folders/F'),
    ctx.appendDesignRow(props, data, 'https://drive.google.com/drive/folders/F'), data.caseNumber];
}
const hoeiData = { ...DATA, company: '株式会社豊栄建設', projectName: '山田 太郎', finish: '2027-02-20' };
const [caseRes, designRes, number] = runDesign(hoeiData);
assert.ok(['2026-11-11@America/Los_Angeles', '2027-02-01@America/Los_Angeles', '2027-02-20@America/Los_Angeles'].every(x => lastParsed.includes(x)),
  'dates are made in the sheet time zone: ' + lastParsed);
assert.strictEqual(number, 'B2611-010', 'next number after the largest this month across every sheet (ロゴス B2611-009)');
assert.strictEqual(designRes, '豊栄建設 row 4');
const hoei = book['豊栄建設'];
const h = name => hoei.cells[0].indexOf(name);
assert.deepStrictEqual([hoei.cells[1][0], hoei.cells[2][0]], ['既存A', '既存B'], 'older rows keep their order');
assert.strictEqual(hoei.cells[3][0], '山田 太郎', 'blank A1 is treated as 顧客名; new row is last');
assert.strictEqual(hoei.cells[3][h('依頼者')], '山田');
assert.strictEqual(hoei.cells[3][h('案件番号')], 'B2611-010');
assert.strictEqual(hoei.formats['4,' + (h('PDF依頼日') + 1)], 'yy/mm/dd');
const handover = hoei.cells[3][h('引渡日')];
assert.ok(handover.getFullYear() === 2027 && handover.getMonth() === 1 && handover.getDate() === 1 && hoei.formats['4,' + (h('引渡日') + 1)] === 'yy/mm');
assert.ok(['作図担当', 'ステータス', '設計料(税抜)'].every(n => !hoei.cells[3][h(n)]), 'internal columns stay blank');
assert.ok(lastParsed.includes('2026-11-20@America/Los_Angeles') && hoei.formats['4,' + (h('図面納品日') + 1)] === 'yy/mm/dd', '希望納期 goes to 図面納品日');
const delivery = hoei.cells[3][h('図面納品日')];
assert.ok(delivery.getFullYear() === 2026 && delivery.getMonth() === 10 && delivery.getDate() === 20);
assert.strictEqual(hoei.cells[3][h('備考')], ['納期短縮：翌営業日（+3万円）', '支店名：大阪支店', '床下暖房種別：AC', '至急'].join(String.fromCharCode(10)));
assert.strictEqual(caseSheet.cells[2][HEADERS.indexOf('案件番号')], 'B2611-010', 'same number in 案件管理表');
// ロゴスは半角カナでも当たり、床下暖房種別の列に入る
runDesign({ ...DATA, company: 'ﾛｺﾞｽﾎｰﾑ', projectName: '田中 花子' });
const logos = book['ロゴスホーム'];
assert.deepStrictEqual([logos.cells[2][0], logos.cells[2][1], logos.cells[2][14], logos.cells[2][15]], ['大阪支店', '田中 花子', 'B2611-011', 'AC']);
// どれにも当たらない会社は「その他」の会社名列へ
runDesign({ ...DATA, company: '山本工務店', projectName: '佐藤 一郎' });
assert.deepStrictEqual([book['その他'].cells[2][0], book['その他'].cells[2][2], book['その他'].cells[2][15]], ['山本工務店', '佐藤 一郎', 'B2611-012']);

if (process.argv.includes('--show')) {
  const show = (name, sheet) => { console.log('\n[' + name + ']'); sheet.cells.forEach((r, i) => console.log(i + 1, JSON.stringify(sheet.cells[0].map((hd, j) => [hd || '(A)', r[j] instanceof Date ? r[j].toISOString().slice(0, 10) : r[j]]).filter(([, v]) => v !== '' && v !== undefined)))); };
  show('豊栄建設', hoei); show('ロゴスホーム', logos); show('その他', book['その他']); show('案件基本情報', caseSheet);
}
// 9. 支店はプルダウンの中から、入力を含む選択肢が1つだけならそれを書く。合わなければ空欄(備考にも書かない)
const BRANCH = HEADERS.indexOf('顧客支店名') + 1;
s = fakeSheet(HEADERS, [], { lists: { [BRANCH]: ['LH札幌北', 'LH函館', '豊栄本社'] } });
run(s, { ...DATA, branch: '札幌北' });
assert.strictEqual(s.cells[1][BRANCH - 1], 'LH札幌北');
s = fakeSheet(HEADERS, [], { lists: { [BRANCH]: ['LH札幌北', '豊栄札幌北'] } });
run(s, { ...DATA, branch: '札幌北' });
assert.strictEqual(s.cells[1][BRANCH - 1], undefined, 'two candidates: leave blank');
assert.strictEqual(s.cells[1][HEADERS.indexOf('備考')], '至急');
assert.deepStrictEqual([...s.pending], []);

console.log('ok: case row tests passed');
