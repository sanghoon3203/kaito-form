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

// 案件基本情報に1行追加する。書くのは C 顧客名, D 顧客支店名, G 案件名, H 案件住所, K 床下暖房種別,
// L 備考, P 着工予定日, Q 完工予定日 だけ。E/F/W などの自動列には値を書かず、直前の行に数式があれば同じ数式を入れる。
// プルダウンの入力規則で拒否された値は、空欄にして備考へ回す。
function appendCaseRow(props, data, folderUrl) {
  const id = props.getProperty('CASE_SHEET_ID');
  if (!id) return 'skipped';
  const sheet = SpreadsheetApp.openById(id).getSheetByName(props.getProperty('CASE_SHEET_NAME') || '案件基本情報');
  if (!sheet) throw new Error('Case sheet not found');
  const maxRows = sheet.getMaxRows();
  const lastIn = col => {
    const bottom = sheet.getRange(maxRows, col);
    return bottom.getValue() !== '' ? maxRows : bottom.getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
  };
  const last = Math.max(lastIn(1), lastIn(3), lastIn(7)); // 案件番号・顧客名・案件名
  if (last >= maxRows) sheet.insertRowAfter(last);
  const row = last + 1;
  const formulas = sheet.getRange(last, 1, 1, sheet.getLastColumn()).getFormulasR1C1()[0];
  formulas.forEach((formula, i) => { if (formula && last > 1) sheet.getRange(row, i + 1).setFormulaR1C1(formula); });

  const toDate = s => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const rejected = [];
  const put = (col, value, label) => {
    if (value === '' || value == null) return;
    try { sheet.getRange(row, col).setValue(value); } catch (error) { rejected.push(label + '：' + value); }
  };
  put(3, safeCell(data.company), '顧客名');
  put(4, safeCell(data.branch), '顧客支店名');
  put(7, safeCell(data.projectName), '案件名');
  put(8, safeCell(data.projectAddress), '案件住所');
  put(11, safeCell(data.heating), '床下暖房種別');
  put(16, toDate(data.start), '着工予定日');
  put(17, toDate(data.finish), '完工予定日');
  const memo = [
    '[フォーム受付 ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd') + '] 担当：' + data.contact + '（' + data.email + '）',
    '図面：' + folderUrl,
    ...rejected,
    data.note || '',
  ].filter(Boolean).join('\n');
  sheet.getRange(row, 12).setValue(safeCell(memo));
  return 'row ' + row;
}

function prepareDriveUploads(props, data) {
  const root = DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID'));
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

function saveUploadReceipt(props, data) {
  const fileLinks = data.files.map(expected => {
    const file = Drive.Files.get(expected.id, { supportsAllDrives: true, fields: 'id,name,size,parents,trashed,webViewLink' });
    if (file.trashed || file.name !== expected.name || Number(file.size) !== expected.size ||
        !file.parents || !file.parents.includes(data.folderId)) throw new Error('Upload is incomplete');
    return file.webViewLink || 'https://drive.google.com/file/d/' + file.id + '/view';
  });
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
      safe(data.branch), safe(data.projectName), safe(data.projectAddress), safe(data.heating), safe(data.note)]);
    if (sheet.getRange('J1').getValue() === '') {
      sheet.getRange('J1:N1').setValues([['支店名', '案件名', '案件住所', '床下暖房種別', '備考']]);
    }
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
  const subject = '【' + displayName + '】' + company + 'からの依頼が届いてます！';
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
    '工事完了予定日　' + (oneLine(data.finish) || '未定'),
    '',
    '添付ファイル（' + filenames.length + '件）',
    ...filenames.map(name => '・' + oneLine(name)),
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
