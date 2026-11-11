// Script properties: ROOT_FOLDER_ID, SHEET_ID, SHARED_SECRET, NOTIFY_EMAIL,
// CASE_SHEET_ID(案件管理表。未設定なら書き込まない), CASE_SHEET_NAME(省略時「案件基本情報」),
// DESIGN_SHEET_ID(設計用・顧客管理。未設定なら書き込まない),
// HOLIDAY_CALENDAR_IDS(休業日を入れた Google カレンダーの ID。カンマ区切り。日本の祝日は自動で含める).
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
    if (data.action === 'holidays') return output(listHolidays(props));
    return output({ok:false});
  } catch(error) {
    console.error('Submission failed: ' + (error && error.stack || error));
    // 原因は SHARED_SECRET を知っている呼び出し元(PHP)にだけ返す。PHP はサーバーのログに残す
    return output(authed ? {ok:false, error: String(error && error.message || error).slice(0, 300)} : {ok:false});
  }
}

// 納品予定日の計算で休みとして扱う日。Google カレンダーの「日本の祝日」と、HOLIDAY_CALENDAR_IDS のカレンダーにある
// 終日の予定を、今日から約13か月分返す。PHP が1日1回これを取りに来る。
const JAPAN_HOLIDAY_CALENDAR = 'ja.japanese#holiday@group.v.calendar.google.com';

function listHolidays(props) {
  const ids = [JAPAN_HOLIDAY_CALENDAR, ...String(props.getProperty('HOLIDAY_CALENDAR_IDS') || '').split(',').map(id => id.trim()).filter(Boolean)];
  const zone = Session.getScriptTimeZone();
  const start = new Date();
  const end = new Date(start.getTime() + 400 * 24 * 3600 * 1000);
  const titles = {};
  const missing = [];
  ids.forEach(id => {
    let calendar = CalendarApp.getCalendarById(id);
    if (!calendar && id === JAPAN_HOLIDAY_CALENDAR) {
      try { calendar = CalendarApp.subscribeToCalendar(id); } catch (error) { /* 下で missing に入る */ }
    }
    if (!calendar) { missing.push(id); return; }
    calendar.getEvents(start, end).forEach(event => {
      if (!event.isAllDayEvent()) return;
      // 「日本の祝日」には、休みにならない行事(七五三・クリスマスなど。説明が「祭日」)も入っているので除く
      if (id === JAPAN_HOLIDAY_CALENDAR && /祭日/.test(event.getDescription() || '')) return;
      const last = event.getAllDayEndDate(); // 終了日は、最後の日の次の日
      for (let day = event.getAllDayStartDate(); day < last; day = new Date(day.getTime() + 24 * 3600 * 1000)) {
        titles[Utilities.formatDate(day, zone, 'yyyy-MM-dd')] = event.getTitle();
      }
    });
  });
  return { ok: true, holidays: Object.keys(titles).sort(), titles, missing };
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
  // 備考は「床下放熱器/二世帯住宅」のように / で区切って1行にする(フォームの備考の改行も / にする)
  const parts = [...memo, ...leftover, ...String(note || '').split(/\r?\n/).map(line => line.trim())].filter(Boolean);
  sheet.getRange(row, colOf('備考')).setValue(safeCell(parts.join('/')));
  return row;
}

// 備考は既存の行と同じく短くする。連絡先・住所・予定日・図面のリンク・【要注意】は、受付一覧と通知メールに残す
// 納品予定日(PHP が営業日で計算)は設計用・顧客管理の「図面納品日」に書く。短縮を選んだときだけ、備考にその内容を書く
// 例:納期短縮：1営業日（+3万円）
const rushLine = data => (data.rush && data.rush !== '希望しない'
  ? '納期短縮：' + data.rush.replace('翌営業日', '1営業日').replace('営業日後', '営業日') : '');

// 設計用・顧客管理では、床下暖房種別を既存の行と同じく備考に書く(例:床下AC)
const heatingLine = data => (data.heating ? '床下' + data.heating : '');

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

// 作図担当・依頼者2・設計者・設計料・特許料・ステータスは社内で入力するので空欄のまま
function appendDesignRow(props, data, folderUrl) {
  const id = idProperty(props, 'DESIGN_SHEET_ID');
  if (!id) return 'skipped';
  const name = designTabName(data.company);
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet) throw new Error('Design tab not found: ' + name);
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const hasCad = (data.files || []).some(file => /\.jww$/i.test(file.name));
  const entries = [
    ...(name === 'その他' ? [['会社名', data.company]] : []),
    // 支店はロゴスホームだけ列に書く。その他は備考に支店名を書き、豊栄・生杉・竹内には書かない
    ...(name === 'ロゴスホーム' ? [[['支店名', '支店'], data.branch, '', { blankIfNoChoice: true, fallback: '' }]] : []),
    ['顧客名', data.projectName],
    ['依頼者', data.contact],
    ['PDF依頼日', day(today), 'yy/mm/dd'],
    // JWW(CAD データ)が届いたときは、CAD依頼日も申し込み日にする。PDF だけなら空欄のまま
    ['CAD依頼日', day(hasCad ? today : ''), 'yy/mm/dd'],
    ['図面納品日', day(data.delivery || data.deadline), 'yy/mm/dd'], // 納品予定日
    ['引渡日', day(data.finish ? data.finish.slice(0, 8) + '01' : ''), 'yy/mm'], // 完工予定日の年月だけ
    ['案件番号', data.caseNumber],
  ];
  return name + ' row ' + appendByHeader(sheet, entries, [rushLine(data), name === 'その他' ? data.branch : '', heatingLine(data)], data.note,
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
    // 保存先は「会社名/案件名」。同じ名前のフォルダがあれば、それを使う
    const child = (parent, name) => { const found = parent.getFoldersByName(name); return found.hasNext() ? found.next() : parent.createFolder(name); };
    const companyFolder = child(root, company);
    const project = String(data.projectName || '').replace(/[\/\\\x00-\x1f]/g, ' ').trim();
    folderId = (project ? child(companyFolder, project) : companyFolder).getId();
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
    ['会社名', company],
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
    '<div style="text-align:center"><img src="cid:baqoolLogo" alt="BAQOOL" height="24" style="height:24px;width:auto"></div>' +
    '<div style="text-align:center;font-size:24px;margin:14px 0 10px">新規図面依頼</div>' +
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
    // ロゴはメールの中に埋め込む(外部の画像は、メールソフトが表示を止めることがあるため)
    const inlineImages = { baqoolLogo: Utilities.newBlob(Utilities.base64Decode(BAQOOL_LOGO_PNG), 'image/png', 'baqool.png') };
    MailApp.sendEmail({ to: recipient, name: displayName, subject, body, htmlBody, attachments, inlineImages });
    return 'sent';
  } catch (error) {
    console.error('Receipt notification failed');
    return 'failed';
  }
}

// 通知メールに埋め込む BAQOOL のロゴ(src/assets/baqool.png を base64 にしたもの)
const BAQOOL_LOGO_PNG = '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';
