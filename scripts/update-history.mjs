// scripts/update-history.mjs
// Chạy trong GitHub Actions (xem .github/workflows/update-history.yml).
// Đọc Google Sheet, tách số bằng ĐÚNG bộ parser mà trang web đang dùng
// (../parse-homecare33.mjs — dùng chung, để hai bên không bao giờ lệch logic),
// rồi ghi/ghi đè 1 dòng lịch sử trong history.json.
//
// Chọn ngày để đóng dấu bằng biến môi trường DATE_MODE:
//   DATE_MODE=yesterday  -> đóng dấu ngày HÔM QUA (dùng cho lần chạy 08:00 sáng:
//                           lúc đó chưa ai nhập số mới, nên số trên sheet chính là
//                           số CHỐT của ngày hôm qua)
//   DATE_MODE=today      -> đóng dấu ngày HÔM NAY (dùng khi bấm chạy tay giữa ngày
//                           để chốt số ngay tại thời điểm đó)
//   DATE_MODE=close      -> CHỐT CUỐI NGÀY (dùng cho lịch chạy 23:35 và lịch dự phòng 08:12):
//                           chạy từ 12:00 trở đi (giờ VN) thì đóng dấu HÔM NAY; chạy trước 12:00
//                           (ví dụ GitHub chạy trễ qua nửa đêm, hoặc lần dự phòng 08:12) thì đóng dấu
//                           HÔM QUA. Nhờ vậy dù lịch bị trễ thì số vẫn rơi đúng vào ngày vừa kết thúc.
// Mặc định: today.
//
// KHÓA CỨNG: mọi dòng lịch sử có ngày TRƯỚC hôm nay (giờ VN) đã tồn tại thì KHÔNG bị ghi đè nữa,
// dù chạy chế độ nào. Chỉ dòng của đúng ngày hôm nay mới được ghi đè (để chốt nhiều lần trong ngày).
// Muốn cố tình sửa số một ngày đã khóa: đặt FORCE=true (trên GitHub: ô "force" khi bấm Run workflow).
//
// Thoát với mã lỗi khác 0 nếu có bất kỳ vấn đề gì — để lần chạy hiện đỏ trên
// GitHub thay vì âm thầm commit số sai.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCsv, extractSnapshot, todaySaigon, yesterdaySaigon, csvUrl } from '../parse-homecare33.mjs';

const SHEET_ID = '1XyNcrpYsXEns2wOqvO5IibtkxuOj-NyGURljeOpneR8';
const SHEET_TAB = 'Homecare33';

// Giờ hiện tại (0-23) theo Asia/Saigon, không phụ thuộc múi giờ máy chạy.
function hourSaigon() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Saigon', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = join(__dirname, '..', 'history.json');

async function main() {
  const mode = (process.env.DATE_MODE || 'today').trim();
  if (mode !== 'today' && mode !== 'yesterday' && mode !== 'close') {
    throw new Error('DATE_MODE không hợp lệ: "' + mode + '" (chỉ chấp nhận "today", "yesterday" hoặc "close").');
  }
  const force = (process.env.FORCE || 'false').trim().toLowerCase() === 'true';
  let stampDate;
  if (mode === 'yesterday') stampDate = yesterdaySaigon();
  else if (mode === 'close') stampDate = hourSaigon() >= 12 ? todaySaigon() : yesterdaySaigon();
  else stampDate = todaySaigon();
  console.log('DATE_MODE=' + mode + ' -> đóng dấu vào ngày ' + stampDate + ' (giờ Việt Nam).');

  const historyBefore = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
  if (!force && stampDate < todaySaigon() && historyBefore.some(h => h.date === stampDate)) {
    console.log('Ngày ' + stampDate + ' ĐÃ ĐƯỢC KHÓA trong history.json — giữ nguyên, không ghi đè. (Muốn sửa cố ý: FORCE=true.)');
    return;
  }

  const res = await fetch(csvUrl(SHEET_ID, SHEET_TAB));
  if (!res.ok) {
    throw new Error('Fetch Google Sheet thất bại: HTTP ' + res.status + '. Kiểm tra sheet còn chia sẻ "Anyone with the link" không.');
  }
  const csvText = await res.text();
  const rows = parseCsv(csvText);
  const snap = extractSnapshot(rows); // ném lỗi nếu cấu trúc sheet đã đổi

  if (snap.warnings.length) {
    console.warn('CẢNH BÁO đối chiếu số liệu (vẫn ghi lại, nhưng cần kiểm tra sheet):');
    snap.warnings.forEach(w => console.warn(' - ' + w));
  }

  const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
  const entry = {
    date: stampDate,
    sbk: snap.sbk,
    hbk: snap.hbk,
  };
  const idx = history.findIndex(h => h.date === stampDate);
  if (idx >= 0) {
    console.log('Đã có dòng cho ngày ' + stampDate + ' — GHI ĐÈ bằng số mới nhất.');
    history[idx] = entry;
  } else {
    console.log('Thêm dòng mới cho ngày ' + stampDate + '.');
    history.push(entry);
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log('Đã cập nhật history.json:', JSON.stringify(entry));
}

main().catch(err => {
  console.error('LỖI khi cập nhật history.json: ' + (err && err.message ? err.message : err));
  console.error('Dừng lại, KHÔNG commit dữ liệu — thà bỏ 1 lần chạy còn hơn ghi số sai.');
  process.exit(1);
});
