// Script properties: ROOT_FOLDER_ID, SHEET_ID, SHARED_SECRET, NOTIFY_EMAIL,
// CASE_SHEET_ID(案件管理表。未設定なら書き込まない), CASE_SHEET_NAME(省略時「案件基本情報」).
function doPost(e) {
  const output = value => ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  try {
    const props = PropertiesService.getScriptProperties();
    const data = JSON.parse(e.postData.contents);
    if (!props.getProperty('SHARED_SECRET') || data.secret !== props.getProperty('SHARED_SECRET')) return output({ok:false});
    if (data.action === 'prepare') return output(prepareDriveUploads(props, data));
    if (data.action === 'finish') return output(saveUploadReceipt(props, data));
    return output({ok:false});
  } catch(error) { console.error('Submission failed'); return output({ok:false}); }
}

const safeCell = value => { const s = String(value || ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };

// 案件基本情報に1行追加する。列は1行目のヘッダー名で探すので、列の追加や並べ替えがあっても正しい列に入る。
// 書くのは下の CASE_COLUMNS と「備考」だけ。顧客住所(自動)などの自動列には値を書かず、直前の行に数式があれば同じ数式を入れる。
// ヘッダーが見つからない値や、プルダウンの入力規則で拒否された値は、備考へ回す。
const CASE_COLUMNS = [
  ['顧客名', data => data.company],
  ['顧客支店名', data => data.branch],
  ['案件名', data => data.projectName],
  ['案件住所', data => data.projectAddress],
  ['床下暖房種別', data => data.heating],
  ['着工予定日', data => data.start],
];
const CASE_DATE_COLUMNS = ['着工予定日'];

function appendCaseRow(props, data, folderUrl) {
  const id = props.getProperty('CASE_SHEET_ID');
  if (!id) return 'skipped';
  const sheet = SpreadsheetApp.openById(id).getSheetByName(props.getProperty('CASE_SHEET_NAME') || '案件基本情報');
  if (!sheet) throw new Error('Case sheet not found');
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(h => String(h).replace(/[\s　]/g, ''));
  const colOf = name => headers.indexOf(name) + 1; // 見つからなければ 0
  if (!colOf('備考')) throw new Error('備考 column not found');

  const maxRows = sheet.getMaxRows();
  const lastIn = col => {
    if (!col) return 1;
    const bottom = sheet.getRange(maxRows, col);
    return bottom.getValue() !== '' ? maxRows : bottom.getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
  };
  const last = Math.max(lastIn(colOf('案件番号')), lastIn(colOf('顧客名')), lastIn(colOf('案件名')));
  if (last >= maxRows) sheet.insertRowAfter(last);
  const row = last + 1;
  if (last > 1) {
    const formulas = sheet.getRange(last, 1, 1, lastColumn).getFormulasR1C1()[0];
    formulas.forEach((formula, i) => { if (formula) sheet.getRange(row, i + 1).setFormulaR1C1(formula); });
  }

  const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const leftover = [];
  CASE_COLUMNS.forEach(([name, pick]) => {
    const text = String(pick(data) || '').trim();
    if (!text) return;
    const col = colOf(name);
    if (!col) { leftover.push(name + '：' + text); return; }
    const value = CASE_DATE_COLUMNS.includes(name) ? toDate(text) : safeCell(text);
    try { sheet.getRange(row, col).setValue(value); } catch (error) { leftover.push(name + '：' + text); }
  });
  const memo = [
    '[フォーム受付 ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd') + '] 担当：' + data.contact + '（' + data.email + '）',
    '図面：' + folderUrl,
    ...(data.warnings || []).map(warning => '【要注意】' + warning),
    ...leftover,
    data.note || '',
  ].filter(Boolean).join('\n');
  sheet.getRange(row, colOf('備考')).setValue(safeCell(memo));
  return 'row ' + row;
}

function prepareDriveUploads(props, data) {
  const root = DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID'));
  if (data.files.some(file => !(file.size > 0 && file.size <= 50 * 1024 * 1024))) return { ok: false }; // api.php と同じ上限
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
  let spreadsheetUrl, caseResult;
  try {
    const sheet = SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getSheets()[0];
    const lastRow = sheet.getLastRow();
    const joinedLinks = fileLinks.join('\n');
    if (lastRow > 1 && sheet.getRange(2, 8, lastRow - 1, 1).createTextFinder(joinedLinks).matchEntireCell(true).findNext()) {
      return { ok: true };
    }
    const attachmentHeaders = sheet.getRange('G1:H1');
    if (attachmentHeaders.getValues()[0].join('|') === '図面PDF名|PDFリンク') {
      attachmentHeaders.setValues([['添付ファイル名', '添付ファイルリンク']]);
    }
    sheet.appendRow([new Date(), safe(data.company), safe(data.contact), safe(data.email), safe(data.start), safe(data.finish),
      safe(data.files.map(file => file.name).join('\n')), joinedLinks, folderUrl,
      safe(data.branch), safe(data.projectName), safe(data.projectAddress), safe(data.heating), safe(data.note),
      safe(data.warnings.join('\n'))]);
    if (sheet.getRange('J1').getValue() === '') {
      sheet.getRange('J1:N1').setValues([['支店名', '案件名', '案件住所', '床下暖房種別', '備考']]);
    }
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
    SpreadsheetApp.flush();
    spreadsheetUrl = sheet.getParent().getUrl();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, caseRow: caseResult,
    notification: notifyReceipt(data, data.files.map(file => file.name), folderUrl, spreadsheetUrl, caseResult) };
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
  const sheet = SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getSheetByName('シート1');
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

function notifyReceipt(data, filenames, folderUrl, spreadsheetUrl, caseResult) {
  const displayName = '株式会社カイトー商会 申込受付';
  const recipient = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!recipient) return;
  const oneLine = value => String(value || '').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  const company = oneLine(data.company);
  const warnings = data.warnings || [];
  const subject = (warnings.length ? '【要注意】' : '') + '【' + displayName + '】' + company + 'からの依頼が届いてます！';
  const body = [
    company + 'から図面の提出がありました。',
    '',
    '支店名　' + (oneLine(data.branch) || '-'),
    '担当者　' + oneLine(data.contact),
    'メールアドレス　' + oneLine(data.email),
    '案件名　' + oneLine(data.projectName),
    '案件住所　' + oneLine(data.projectAddress),
    '床下暖房種別　' + (oneLine(data.heating) || '未定'),
    '着工予定日　' + (oneLine(data.start) || '未定'),
    '',
    '添付ファイル（' + filenames.length + '件）',
    ...filenames.map(name => '・' + oneLine(name)),
    ...(warnings.length ? ['', '【要注意】添付ファイルの検査で、次の点が見つかりました（開くと動作を起こせる要素、または未検査のファイル）。',
      'ダウンロードせず、Google ドライブのプレビューで確認してください。', ...warnings.map(w => '・' + oneLine(w))] : []),
    '',
    '図面の保存先（Google ドライブ）',
    folderUrl,
    '',
    '受付一覧',
    spreadsheetUrl,
    '',
    '案件管理表への登録　' + (caseResult === 'failed' ? '失敗しました。手入力してください。' : caseResult === 'skipped' ? '未設定' : caseResult),
    ...(data.note ? ['', '備考', String(data.note)] : []),
  ].join('\n');
  try {
    MailApp.sendEmail({ to: recipient, name: displayName, subject, body });
    return 'sent';
  } catch (error) {
    console.error('Receipt notification failed');
    return 'failed';
  }
}
