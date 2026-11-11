// Script properties: ROOT_FOLDER_ID, SHEET_ID, SHARED_SECRET, NOTIFY_EMAIL,
// CASE_SHEET_ID(案件管理表。未設定なら書き込まない), CASE_SHEET_NAME(省略時「案件基本情報」),
// DESIGN_SHEET_ID(設計用・顧客管理。未設定なら書き込まない).
function doPost(e) {
  const output = value => ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  let authed = false;
  try {
    const props = PropertiesService.getScriptProperties();
    const data = JSON.parse(e.postData.contents);
    if (!props.getProperty('SHARED_SECRET') || data.secret !== props.getProperty('SHARED_SECRET')) return output({ok:false});
    authed = true;
    if (data.action === 'prepare') return output(prepareDriveUploads(props, data));
    if (data.action === 'finish') return output(saveUploadReceipt(props, data));
    return output({ok:false});
  } catch(error) {
    console.error('Submission failed: ' + (error && error.stack || error));
    // 原因は SHARED_SECRET を知っている呼び出し元(PHP)にだけ返す。PHP はサーバーのログに残す
    return output(authed ? {ok:false, error: String(error && error.message || error).slice(0, 300)} : {ok:false});
  }
}

// Script Properties の ID は、ブラウザのアドレス欄の URL をそのまま貼ってもよい
// (…/folders/<ID> や …/spreadsheets/d/<ID>/edit から ID を取り出す)
function idProperty(props, key) {
  const value = String(props.getProperty(key) || '').trim();
  const match = value.match(/\/(?:folders|d)\/([\w-]{10,})/);
  return match ? match[1] : value;
}

const safeCell = value => { const s = String(value || ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };

// 書き込み先は2つ。どちらも列は1行目のヘッダー名で探すので、列の追加や並べ替えがあっても正しい列に入る。
// ・案件管理表「案件基本情報」(CASE_SHEET_ID)
// ・設計用・顧客管理(DESIGN_SHEET_ID)。会社名でタブを選び、どれにも当たらなければ「その他」
// 案件番号は受付ごとに1つ作り(B + 年月 + - + 3桁の連番。月ごとに001から)、両方に同じ番号を書く。
const CASE_COLUMNS = [
  ['案件番号', data => data.caseNumber],
  ['顧客名', data => data.company],
  ['顧客支店名', data => data.branch],
  ['案件名', data => data.projectName],
  ['案件住所', data => data.projectAddress],
  ['床下暖房種別', data => data.heating],
  ['着工予定日', data => data.start],
  ['完工予定日', data => data.finish],
];
const CASE_DATE_COLUMNS = ['着工予定日', '完工予定日'];
const DESIGN_TABS = { '豊栄': '豊栄建設', 'ロゴス': 'ロゴスホーム', '生杉': '生杉建設', '竹内': '竹内建設' };

// 日付は「yyyy-MM-dd」の暦日のまま渡し、書き込むときにシートのタイムゾーンで日付にする
// (スクリプトとシートのタイムゾーンが違うと、new Date(y, m, d) では1日ずれる)
const day = s => (s ? { day: String(s) } : '');
// プルダウンの選択肢と照らすときは、株式会社・㈱・空白などの違いを無視する
const looseName = s => String(s).normalize('NFKC').replace(/株式会社|有限会社|合同会社|\((株|有|同)\)|[\s　]/g, '');
const headersOf = sheet => sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).replace(/[\s　]/g, ''));

function openCaseSheet(props) {
  const id = idProperty(props, 'CASE_SHEET_ID');
  if (!id) return null;
  const sheet = SpreadsheetApp.openById(id).getSheetByName(props.getProperty('CASE_SHEET_NAME') || '案件基本情報');
  if (!sheet) throw new Error('Case sheet not found');
  return sheet;
}

function openDesignTabs(props) {
  const id = idProperty(props, 'DESIGN_SHEET_ID');
  if (!id) return [];
  const book = SpreadsheetApp.openById(id);
  return [...Object.values(DESIGN_TABS), 'その他'].map(name => book.getSheetByName(name)).filter(Boolean);
}

function designTabName(company) {
  const name = String(company || '').normalize('NFKC'); // 半角カナの「ﾛｺﾞｽ」なども当てる
  const key = Object.keys(DESIGN_TABS).find(k => name.includes(k));
  return key ? DESIGN_TABS[key] : 'その他';
}

// 今月の案件番号のうち、渡したすべてのシートで一番大きいものの次。呼び出し側でスクリプトのロックを取っておく
function nextCaseNumber(sheets) {
  const prefix = 'B' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyMM') + '-';
  let max = 0;
  sheets.forEach(sheet => {
    const col = headersOf(sheet).indexOf('案件番号') + 1;
    const rows = sheet.getLastRow();
    if (!col || rows < 2) return;
    sheet.getRange(2, col, rows - 1, 1).getValues().forEach(([value]) => {
      const text = String(value).trim();
      if (text.startsWith(prefix) && /^\d+$/.test(text.slice(prefix.length))) max = Math.max(max, Number(text.slice(prefix.length)));
    });
  });
  return prefix + String(max + 1).padStart(3, '0');
}

// 1行追加する。entries は [ヘッダー名(別名があれば配列), 値, 表示形式]。値を書かないヘッダーの列には触らず、
// 直前の行に数式があれば同じ数式を入れる。ヘッダーが見つからない値や、入力規則に拒否された値は備考へ回す。
// insideLastRow: 最終行の上に行を挿入してから最終行と入れ替える。集計式の範囲(…:最終行)を新しい行まで広げるため。
function appendByHeader(sheet, entries, memo, note, { insideLastRow = false, firstHeader = '' } = {}) {
  const lastColumn = sheet.getLastColumn();
  const headers = headersOf(sheet);
  if (firstHeader && !headers[0]) headers[0] = firstHeader; // 1列目の見出しが空のタブ
  const colOf = name => headers.indexOf(name) + 1; // 見つからなければ 0
  if (!colOf('備考')) throw new Error('備考 column not found');

  const maxRows = sheet.getMaxRows();
  const lastIn = col => {
    if (!col) return 1;
    const bottom = sheet.getRange(maxRows, col);
    return bottom.getValue() !== '' ? maxRows : bottom.getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
  };
  const last = Math.max(...[...entries.flatMap(([names]) => [].concat(names)), '備考'].map(name => lastIn(colOf(name))));
  const row = last + 1;
  if (insideLastRow && last > 1) {
    sheet.insertRowBefore(last);
    const moved = sheet.getRange(row, 1, 1, lastColumn); // 元の最終行
    moved.copyTo(sheet.getRange(last, 1, 1, lastColumn));
    moved.clearContent();
  } else if (last >= maxRows) {
    sheet.insertRowAfter(last);
  }
  if (last > 1) {
    const formulas = sheet.getRange(row - 1, 1, 1, lastColumn).getFormulasR1C1()[0];
    formulas.forEach((formula, i) => { if (formula) sheet.getRange(row, i + 1).setFormulaR1C1(formula); });
  }

  // 入力規則(プルダウン)の選択肢。スプレッドシートは規則違反を setValue の時点では投げず、
  // 後でまとめて反映するときに投げる(try で拾えない)ので、書く前に確かめる。選択肢がなければ null
  const choices = cell => {
    const rule = cell.getDataValidation();
    if (!rule || rule.getAllowInvalid()) return null;
    const type = rule.getCriteriaType();
    const [arg] = rule.getCriteriaValues();
    const C = SpreadsheetApp.DataValidationCriteria;
    if (type === C.VALUE_IN_LIST) return arg.map(String);
    if (type === C.VALUE_IN_RANGE) return arg.getValues().flat().map(String).filter(Boolean);
    return null;
  };
  const tz = sheet.getParent().getSpreadsheetTimeZone();
  const leftover = [];
  // 選択肢の中から入力に合うものを探す。完全一致 → 株式会社などの違いを無視して一致 → 入力を含む選択肢が1つだけ
  // (例:支店「札幌北」→「LH札幌北」)。見つからなければ undefined
  const pick = (options, text) => {
    if (options.includes(text)) return text;
    const loose = looseName(text);
    const same = options.find(option => looseName(option) === loose);
    if (same) return same;
    // 支店名: 「支店」などを外した名前を含む選択肢を探す。複数あれば、HC(カフェ)かどうかで絞り、
    // それでも複数なら、先頭の英字(LH・HC)を外して完全に一致するものにする
    const wantsHc = /HC|カフェ/i.test(loose);
    const core = loose.replace(/^(LH|HC|ロゴスホーム|ハウジングカフェ|カフェ)/i, '').replace(/(支店|営業所|店)$/, '');
    if (!core) return undefined;
    let found = options.filter(option => looseName(option).includes(core));
    if (found.length > 1) found = found.filter(option => /^HC/i.test(option) === wantsHc);
    if (found.length > 1) found = found.filter(option => looseName(option).replace(/^[A-Za-z]+/, '') === core);
    return found.length === 1 ? found[0] : undefined;
  };
  // entries の4つ目: blankIfNoChoice は、選択肢に合わないとき備考へ回さず空欄にする。
  // fallback は、列がないときに備考へ書く文(省略時は「ヘッダー名：値」。空文字なら書かない)
  entries.forEach(([names, value, format, { blankIfNoChoice = false, fallback } = {}]) => {
    const isDate = Boolean(value && value.day);
    const text = isDate ? value.day.replace(/-/g, '/') : String(value || '').trim();
    if (!text) return;
    const col = colOf([].concat(names).find(name => colOf(name)) || '');
    if (!col) { leftover.push(fallback === undefined ? [].concat(names)[0] + '：' + text : fallback); return; }
    try {
      const cell = sheet.getRange(row, col);
      const allowed = isDate ? null : choices(cell);
      const choice = allowed && pick(allowed, text);
      if (allowed && !choice) { if (!blankIfNoChoice) leftover.push([].concat(names)[0] + '：' + text); return; }
      if (format) cell.setNumberFormat(format);
      cell.setValue(isDate ? Utilities.parseDate(value.day, tz, 'yyyy-MM-dd') : safeCell(choice || text));
    } catch (error) { leftover.push([].concat(names)[0] + '：' + text); }
  });
  sheet.getRange(row, colOf('備考')).setValue(safeCell([...memo, ...leftover, note || ''].filter(Boolean).join('\n')));
  return row;
}

// 備考は既存の行と同じく短くする。連絡先・住所・予定日・図面のリンク・【要注意】は、受付一覧と通知メールに残す
// 納品予定日(PHP が営業日で計算)は設計用・顧客管理の「図面納品日」に書く。短縮を選んだときだけ、備考にその内容を書く
// 例:納期短縮：1営業日（+3万円）
const rushLine = data => (data.rush && data.rush !== '希望しない'
  ? '納期短縮：' + data.rush.replace('翌営業日', '1営業日').replace('営業日後', '営業日') : '');

function appendCaseRow(props, data, folderUrl) {
  const sheet = openCaseSheet(props);
  if (!sheet) return 'skipped';
  // 支店はロゴスホームだけに書く(ほかの会社は、既存の行でも空欄)
  const logos = designTabName(data.company) === 'ロゴスホーム';
  const entries = CASE_COLUMNS.map(([name, pick]) => name === '顧客支店名'
    ? [name, logos ? data.branch : '', '', { blankIfNoChoice: true, fallback: '' }]
    : [name, CASE_DATE_COLUMNS.includes(name) ? day(pick(data)) : pick(data)]);
  return 'row ' + appendByHeader(sheet, entries, [], data.note);
}

// 作図担当・依頼者2・CAD依頼日・設計者・設計料・特許料・ステータスは社内で入力するので空欄のまま
function appendDesignRow(props, data, folderUrl) {
  const id = idProperty(props, 'DESIGN_SHEET_ID');
  if (!id) return 'skipped';
  const name = designTabName(data.company);
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet) throw new Error('Design tab not found: ' + name);
  const entries = [
    ...(name === 'その他' ? [['会社名', data.company]] : []),
    // 支店はロゴスホームだけ列に書く。その他は備考に支店名を書き、豊栄・生杉・竹内には書かない
    ...(name === 'ロゴスホーム' ? [[['支店名', '支店'], data.branch, '', { blankIfNoChoice: true, fallback: '' }]] : []),
    ['顧客名', data.projectName],
    ['依頼者', data.contact],
    ['PDF依頼日', day(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')), 'yy/mm/dd'],
    ['図面納品日', day(data.delivery || data.deadline), 'yy/mm/dd'], // 納品予定日
    ['引渡日', day(data.finish ? data.finish.slice(0, 8) + '01' : ''), 'yy/mm'], // 完工予定日の年月だけ
    ['案件番号', data.caseNumber],
    ['床下暖房種別', data.heating, '', { fallback: '床下' + data.heating }], // 列がないタブでは、既存の行と同じく備考に「床下AC」
  ];
  return name + ' row ' + appendByHeader(sheet, entries, [rushLine(data), name === 'その他' ? data.branch : ''], data.note,
    { insideLastRow: true, firstHeader: '顧客名' });
}

function prepareDriveUploads(props, data) {
  const root = DriveApp.getFolderById(idProperty(props, 'ROOT_FOLDER_ID'));
  if (data.files.some(file => !(file.size > 0 && file.size <= 8 * 1024 * 1024))) return { ok: false }; // src/lib.php と同じ上限(1ファイル8MB)
  const company = data.company.replace(/[\/\\\x00-\x1f]/g, ' ').trim();
  if (!company) return { ok: false };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let folderId;
  try {
    const existing = root.getFoldersByName(company);
    folderId = (existing.hasNext() ? existing.next() : root.createFolder(company)).getId();
  } finally {
    lock.releaseLock();
  }

  const ids = Drive.Files.generateIds({ count: data.files.length, space: 'drive' }).ids;
  const auth = 'Bearer ' + ScriptApp.getOAuthToken();
  const requests = data.files.map((file, i) => {
    const name = file.name.replace(/[\/\\\x00-\x1f]/g, ' ');
    const type = /\.pdf$/i.test(name) ? 'application/pdf' : 'application/octet-stream';
    const upload = { id: ids[i], size: file.size, type, name };
    const request = {
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id',
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: auth, 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(file.size) },
      payload: JSON.stringify({ id: upload.id, name, mimeType: type, parents: [folderId] }),
      followRedirects: false,
      muteHttpExceptions: true,
    };
    return { upload, request };
  });
  const responses = UrlFetchApp.fetchAll(requests.map(({ request }) => request));
  const uploads = responses.map((response, i) => {
    const headers = response.getAllHeaders();
    const location = Object.keys(headers).find(key => key.toLowerCase() === 'location');
    if (response.getResponseCode() !== 200 || !location) throw new Error('Could not start Drive upload');
    return { ...requests[i].upload, url: headers[location] };
  });
  return { ok: true, folderId, uploads };
}

// PDF の中にある、開いたときに動作を起こせる要素の名前。正常な図面にも入ることがあるので、拒否せず「要注意」として知らせる。
// 名前は #xx(16進)で書き換えて隠せるので、元に戻してから探す。圧縮されたストリームの中までは見えない。
const RISKY_PDF_NAMES = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData|GoToR)(?![A-Za-z0-9])/g;
const SCAN_BUDGET = 100 * 1024 * 1024; // ponytail: 1回の受付で検査する合計サイズ。受付が遅くなりすぎないための上限

function findRiskyPdfNames(bytes) {
  const text = Utilities.newBlob(bytes).getDataAsString('ISO-8859-1')
    .replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return [...new Set(text.match(RISKY_PDF_NAMES) || [])];
}

const FILE_SIGNATURES = { pdf: '%PDF-', jww: 'JwwData.' }; // api.php と同じ

// ドライブに保存されたファイルの先頭を読み、拡張子どおりの形式かを確かめる。api.php でも確かめているが、
// 中継を通らずに送られた場合に備えて、ここでもう一度見る。
function hasExpectedHeader(file) {
  const signature = FILE_SIGNATURES[((file.name.match(/\.([a-z]+)$/i) || [])[1] || '').toLowerCase()];
  if (!signature) return false;
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) +
    '?alt=media&supportsAllDrives=true', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=0-' + (signature.length - 1) },
    muteHttpExceptions: true,
  });
  const head = response.getContent().slice(0, signature.length).map(b => String.fromCharCode(b & 255)).join('');
  return response.getResponseCode() < 300 && head === signature;
}

function inspectUploadedFiles(files) {
  let budget = SCAN_BUDGET;
  const warnings = [];
  files.forEach(file => {
    let headerOk = false;
    try { headerOk = hasExpectedHeader(file); } catch (error) { /* 下で扱う */ }
    if (!headerOk) {
      // 拡張子と中身が違うファイル(実行ファイルの偽装など)は、開かれないようにゴミ箱へ移す
      try { DriveApp.getFileById(file.id).setTrashed(true); } catch (error) { /* 警告だけ残す */ }
      warnings.push(file.name + '：拡張子と中身の形式が一致しないため、ゴミ箱に移しました');
      return;
    }
    if (!/\.pdf$/i.test(file.name)) return;
    if (file.size > budget) { warnings.push(file.name + '：未検査（合計サイズの上限を超えたため）'); return; }
    budget -= file.size;
    try {
      const found = findRiskyPdfNames(DriveApp.getFileById(file.id).getBlob().getBytes());
      if (found.length) warnings.push(file.name + '：' + found.join(' '));
    } catch (error) {
      warnings.push(file.name + '：検査できませんでした');
    }
  });
  return warnings;
}

function saveUploadReceipt(props, data) {
  const fileLinks = data.files.map(expected => {
    const file = Drive.Files.get(expected.id, { supportsAllDrives: true, fields: 'id,name,size,parents,trashed,webViewLink' });
    if (file.trashed || file.name !== expected.name || Number(file.size) !== expected.size ||
        !file.parents || !file.parents.includes(data.folderId)) throw new Error('Upload is incomplete');
    return file.webViewLink || 'https://drive.google.com/file/d/' + file.id + '/view';
  });
  data.warnings = inspectUploadedFiles(data.files);
  const safe = safeCell;
  const folderUrl = 'https://drive.google.com/drive/folders/' + data.folderId;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let spreadsheetUrl, caseResult, designResult;
  try {
    const sheet = SpreadsheetApp.openById(idProperty(props, 'SHEET_ID')).getSheets()[0];
    const lastRow = sheet.getLastRow();
    const joinedLinks = fileLinks.join('\n');
    if (lastRow > 1 && sheet.getRange(2, 8, lastRow - 1, 1).createTextFinder(joinedLinks).matchEntireCell(true).findNext()) {
      return { ok: true };
    }
    // 案件番号は、案件管理表と設計用・顧客管理の全タブを見て決める。読めないシートがあっても、読めた分で決める
    const numbered = [];
    try { const caseSheet = openCaseSheet(props); if (caseSheet) numbered.push(caseSheet); } catch (error) { console.error('Could not read case sheet'); }
    try { numbered.push(...openDesignTabs(props)); } catch (error) { console.error('Could not read design sheet'); }
    data.caseNumber = nextCaseNumber(numbered);
    const attachmentHeaders = sheet.getRange('G1:H1');
    if (attachmentHeaders.getValues()[0].join('|') === '図面PDF名|PDFリンク') {
      attachmentHeaders.setValues([['添付ファイル名', '添付ファイルリンク']]);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['受付日時', '会社名', '担当者', 'メールアドレス', '着工予定日', '完工予定日', '添付ファイル名', '添付ファイルリンク',
        '保存フォルダ', '支店名', '案件名', '案件住所', '床下暖房種別', '備考', '要注意', '図面の希望納期', '納期の短縮', '案件番号', '納品予定日']);
    }
    // 受付日時は日本時間の文字列で書く(Date のまま渡すと、スクリプトのタイムゾーンの時刻で入る)
    sheet.appendRow([Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'), safe(data.company), safe(data.contact), safe(data.email), safe(data.start), safe(data.finish),
      safe(data.files.map(file => file.name).join('\n')), joinedLinks, folderUrl,
      safe(data.branch), safe(data.projectName), safe(data.projectAddress), safe(data.heating), safe(data.note),
      safe(data.warnings.join('\n')), safe(data.deadline), safe(data.rush), data.caseNumber, safe(data.delivery)]);
    if (sheet.getRange('J1').getValue() === '') {
      sheet.getRange('J1:N1').setValues([['支店名', '案件名', '案件住所', '床下暖房種別', '備考']]);
    }
    if (sheet.getRange('P1').getValue() === '') sheet.getRange('P1:Q1').setValues([['図面の希望納期', '納期の短縮']]);
    if (sheet.getRange('R1').getValue() === '') sheet.getRange('R1:S1').setValues([['案件番号', '納品予定日']]);
    if (sheet.getRange('F1').getValue() === '工事完了予定日') sheet.getRange('F1').setValue('完工予定日');
    if (sheet.getRange('O1').getValue() === '') sheet.getRange('O1').setValue('要注意');
    if (fileLinks.length > 1) {
      try {
        const linkCell = sheet.getRange(2, 8, sheet.getLastRow() - 1, 1).createTextFinder(joinedLinks).matchEntireCell(true).findNext();
        if (linkCell) setReceiptFileLinks(linkCell, joinedLinks);
      } catch (error) {
        console.error('Could not format receipt attachment links');
      }
    }
    try {
      caseResult = appendCaseRow(props, data, folderUrl);
    } catch (error) {
      console.error('Could not append case row: ' + error.message);
      caseResult = 'failed';
    }
    try {
      designResult = appendDesignRow(props, data, folderUrl);
    } catch (error) {
      console.error('Could not append design row: ' + error.message);
      designResult = 'failed';
    }
    SpreadsheetApp.flush();
    spreadsheetUrl = sheet.getParent().getUrl();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, caseRow: caseResult,
    notification: notifyReceipt(data, data.files.map(file => file.name), folderUrl, spreadsheetUrl, caseResult, designResult) };
}

function setReceiptFileLinks(cell, text) {
  const urls = text.split('\n');
  if (urls.length < 2 || !urls.every(url => /^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view(?:\?[^\s]*)?$/.test(url))) return;
  const richText = SpreadsheetApp.newRichTextValue().setText(text);
  let offset = 0;
  for (const url of urls) {
    richText.setLinkUrl(offset, offset + url.length, url);
    offset += url.length + 1;
  }
  cell.setRichTextValue(richText.build());
}

function repairReceiptSheetDisplay() {
  const props = PropertiesService.getScriptProperties();
  const sheet = SpreadsheetApp.openById(idProperty(props, 'SHEET_ID')).getSheetByName('シート1');
  const widths = [148, 150, 112, 194, 104, 120, 222, 160, 139];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.getRange('B2:D').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sheet.getRange('G2:G').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sheet.getRange('H2:I').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange('A1:I1').setFontWeight('bold').setBackground('#f1f3f4');

  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return;
  const links = sheet.getRange(2, 8, rowCount, 1);
  const values = links.getValues();
  const formulas = links.getFormulas();
  values.forEach(([value], index) => {
    if (!formulas[index][0] && typeof value === 'string') setReceiptFileLinks(links.getCell(index + 1, 1), value);
  });
}

function verifyUploadAccess() {
  const result = Drive.Files.generateIds({ count: 1, space: 'drive' });
  if (!result.ids.length) throw new Error('Drive API unavailable');
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=kind', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  });
}

// メールに添付する合計サイズの上限(Gmail の上限は25MB。符号化で増える分を見込む)
const MAIL_ATTACH_LIMIT = 18 * 1024 * 1024;

// 通知メールに添付するファイルを選ぶ。【要注意】のファイル(開かないほうがよいもの)と、上限を超える分は添付しない
function mailAttachments(data) {
  const flagged = new Set((data.warnings || []).map(w => String(w).split('：')[0]));
  const attachments = [];
  const skipped = [];
  let total = 0;
  (data.files || []).forEach(file => {
    if (flagged.has(file.name) || total + file.size > MAIL_ATTACH_LIMIT) { skipped.push(file.name); return; }
    try {
      attachments.push(DriveApp.getFileById(file.id).getBlob().setName(file.name));
      total += file.size;
    } catch (error) { skipped.push(file.name); }
  });
  return { attachments, skipped };
}

function notifyReceipt(data, filenames, folderUrl, spreadsheetUrl, caseResult, designResult) {
  const displayName = '株式会社カイトー商会 申込受付';
  const recipient = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!recipient) return;
  const oneLine = value => String(value || '').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  const company = oneLine(data.company);
  const warnings = data.warnings || [];
  const rush = data.rush && data.rush !== '希望しない' ? '【納期短縮】' : '';
  const { attachments, skipped } = mailAttachments(data);
  const subject = (warnings.length ? '【要注意】' : '') + rush + '【' + displayName + '】' + company + 'からの依頼が届いてます！';
  const rows = [
    ['案件番号', oneLine(data.caseNumber)],
    ['支店名', oneLine(data.branch) || '-'],
    ['担当者', oneLine(data.contact)],
    ['メールアドレス', oneLine(data.email)],
    ['案件名', oneLine(data.projectName)],
    ['案件住所', oneLine(data.projectAddress)],
    ['床下暖房種別', oneLine(data.heating) || '未定'],
    ['着工予定日', oneLine(data.start) || '未定'],
    ['完工予定日', oneLine(data.finish) || '未定'],
    ['図面の希望納期', oneLine(data.deadline) || '-'],
    ['納期の短縮', oneLine(data.rush) || '希望しない'],
    ['納品予定日', oneLine(data.delivery) || '-'],
  ];
  // シートへの登録は、失敗したときだけ知らせる
  const failures = [['案件管理表', caseResult], ['設計用・顧客管理', designResult]].filter(([, result]) => result === 'failed')
    .map(([label]) => label + 'への登録に失敗しました。手入力してください。');
  const body = [
    company + 'から図面の提出がありました。',
    '',
    ...rows.map(([label, value]) => label + '　' + value),
    '',
    '添付ファイル（' + filenames.length + '件）',
    ...filenames.map(name => '・' + oneLine(name)),
    ...(skipped.length ? ['※ 次のファイルはメールに添付していません（要注意、または合計サイズの上限超過）。Google ドライブでご確認ください。',
      ...skipped.map(name => '　・' + oneLine(name))] : []),
    ...(warnings.length ? ['', '【要注意】添付ファイルの検査で、次の点が見つかりました（開くと動作を起こせる要素、または未検査のファイル）。',
      'ダウンロードせず、Google ドライブのプレビューで確認してください。', ...warnings.map(w => '・' + oneLine(w))] : []),
    ...(failures.length ? ['', ...failures] : []),
    ...(data.note ? ['', '備考', String(data.note)] : []),
  ].join('\n');

  // HTML メール(カード型)。HTML を表示できないメールソフトには、上の本文が表示される
  const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const section = (title, lines, color) => !lines.length ? '' :
    '<div style="margin-top:20px;padding:14px 16px;border-radius:8px;background:' + (color || '#f5f5f7') + ';font-size:13px;line-height:1.7">' +
    '<div style="font-weight:700;margin-bottom:4px">' + esc(title) + '</div>' + lines.map(line => '<div>' + esc(line) + '</div>').join('') + '</div>';
  const htmlBody =
    '<div style="max-width:560px;margin:0 auto;padding:32px 28px;border:1px solid #dadce0;border-radius:12px;' +
    'font-family:\'Noto Sans JP\',\'Hiragino Sans\',Meiryo,Arial,sans-serif;color:#1d1d1f">' +
    '<div style="text-align:center;font-size:20px;font-weight:700;letter-spacing:.12em;color:#00a5a5">BAQOOL</div>' +
    '<div style="text-align:center;font-size:24px;margin:14px 0 10px">新しい図面依頼</div>' +
    '<div style="text-align:center;font-size:14px;color:#3c4043;margin-bottom:22px">' + esc(company) + '</div>' +
    '<div style="border-top:1px solid #dadce0"></div>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:14px">' +
    rows.map(([label, value]) => '<tr><td style="padding:9px 0;color:#6e6e73;width:9em;vertical-align:top;border-bottom:1px solid #f0f0f2">' +
      esc(label) + '</td><td style="padding:9px 0;border-bottom:1px solid #f0f0f2">' + esc(value) + '</td></tr>').join('') +
    '</table>' +
    section('添付ファイル（' + filenames.length + '件）', filenames.map(name => '・' + oneLine(name))) +
    section('メールに添付していないファイル（要注意、または合計サイズの上限超過）', skipped.map(name => '・' + oneLine(name)), '#fff2f4') +
    section('【要注意】添付ファイルの検査で見つかった点。ダウンロードせず、Google ドライブのプレビューで確認してください。',
      warnings.map(w => '・' + oneLine(w)), '#fff2f4') +
    section('シートへの登録', failures, '#fff2f4') +
    section('備考', data.note ? String(data.note).split('\n') : []) +
    '</div>';
  try {
    MailApp.sendEmail({ to: recipient, name: displayName, subject, body, htmlBody, attachments });
    return 'sent';
  } catch (error) {
    console.error('Receipt notification failed');
    return 'failed';
  }
}
