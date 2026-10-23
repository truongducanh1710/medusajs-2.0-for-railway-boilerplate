import { useEffect, useState } from "react"

// In-app copy of "Hướng dẫn Sale: Trang Xác nhận đơn" (Claude Docs, 23/10/2026) so sales can
// re-read it from the page itself without a claude.ai account. Keep both in step when the page
// changes.

const H2 = ({ children }: { children: any }) => <h2 className="text-base font-semibold mt-6 mb-2">{children}</h2>
const P = ({ children }: { children: any }) => <p className="text-sm text-gray-700 leading-relaxed mb-2">{children}</p>
const Table = ({ head, rows }: { head: string[]; rows: (string | any)[][] }) => (
  <div className="overflow-x-auto mb-3">
    <table className="w-full text-sm border rounded">
      <thead className="bg-gray-50 text-gray-600">
        <tr>{head.map((h) => <th key={h} className="text-left px-3 py-1.5 font-medium">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => <tr key={i} className="border-t align-top">{r.map((c, j) => <td key={j} className="px-3 py-1.5">{c}</td>)}</tr>)}
      </tbody>
    </table>
  </div>
)

const SEEN_KEY = "xac-nhan-don.guide-seen.v1"

/** "📘 Hướng dẫn" button + side panel. Shows a "Mới" dot until the sale opens it once. */
export default function XacNhanGuide() {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(true)
  useEffect(() => { try { setSeen(localStorage.getItem(SEEN_KEY) === "1") } catch {} }, [])
  const show = () => {
    setOpen(true)
    setSeen(true)
    try { localStorage.setItem(SEEN_KEY, "1") } catch {}
  }

  return (
    <>
      <button onClick={show} className="relative px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
        📘 Hướng dẫn
        {!seen && <span className="absolute -top-1.5 -right-1.5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">Mới</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-3xl h-full overflow-y-auto px-6 pb-10 shadow-2xl">
            <div className="sticky top-0 bg-white border-b py-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">Hướng dẫn Sale: Trang Xác nhận đơn</div>
                <div className="text-xs text-gray-500">Cập nhật 23/10/2026</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Đóng" className="px-3 py-2 border rounded-lg text-gray-500 hover:bg-gray-50">✕</button>
            </div>

            <H2>Trang này để làm gì</H2>
            <P>Đây là danh sách việc của bạn: mọi đơn mới chưa xử lý xong trong 14 ngày, đơn nào cần gọi trước thì nằm trên. Bạn gọi, ghi kết quả, sửa đơn ngay trên trang và hệ thống đẩy thẳng sang POS — không cần mở POS.</P>
            <P>Một luật bắt buộc: <b>gọi lần nào ghi kết quả lần đó</b>, kể cả khi chốt được. Hệ thống đối chiếu với tổng đài, cuộc gọi nào chưa có note sẽ bị báo cam trên đầu trang và quản lý nhìn thấy.</P>

            <H2>Mở trang và xem tổng quan</H2>
            <P>Ô chọn sale mặc định là <b>Của tôi</b> — chỉ đơn đang gán cho bạn trên POS. Đơn Shopee, TikTok Shop không có ở đây. Bấm vào ô số nào thì bảng lọc theo ô đó.</P>
            <Table head={["Ô", "Ý nghĩa"]} rows={[
              ["Tồn chờ xử lý", "Tất cả đơn còn ở trạng thái Mới"],
              ["Cần gọi ngay", "Đã đến hạn gọi"],
              ["Quá hạn", "Quá hạn gọi hơn 30 phút — ưu tiên xử lý"],
              ["Hẹn gọi lại", "Khách đã hẹn giờ"],
              ["Gọi chưa note", "Cuộc gọi tổng đài chưa ghi kết quả"],
              ["Chờ kho / chờ hàng", "Đơn đã chốt, đang chờ kho đóng"],
            ]} />
            <P>Các tab: <b>Hàng đợi</b> (làm việc chính), <b>Chờ kho / chờ hàng</b>, <b>Đề xuất hủy</b> (khách không đặt hoặc đã gọi 5 lần), <b>Quản lý</b>.</P>

            <H2>Đọc bảng đơn</H2>
            <P>Nhãn cam <b>NHÁP</b> trước tên khách = đơn đang gắn thẻ "Đơn nháp" trên POS.</P>
            <Table head={["Cột", "Xem gì"]} rows={[
              ["Khách / đơn", "Tên, số tiền thu, mã đơn, sản phẩm, giờ tạo"],
              ["Việc tiếp theo", "Gọi lần đầu / Gọi lần 2, 3 / Hẹn gọi / Đề xuất hủy. Nhãn xanh bên cạnh = lý do đơn được đẩy lên (đơn to, khách tốt, khách cũ, chờ lâu)"],
              ["Gọi / note", "Số lượt gọi tổng đài / số note. Có ⚠ là có cuộc gọi chưa ghi note"],
              ["Hạn", "Còn bao lâu tới hạn gọi, hoặc đã quá bao lâu (chữ đỏ)"],
              ["Uy tín khách", "Đơn thành công / hoàn của SĐT trên toàn mạng Pancake. Xanh = khách tốt, đỏ = hay hoàn"],
              ["Cảnh báo", "Lệch gói (tiền thu khác gói trên landing) · Chưa xã (kho không giao được) · Trùng SĐT"],
            ]} />
            <P>Hạn gọi tính trong giờ 8:00–21:00: đơn mới 15 phút; KNM lần 1 gọi lại sau 2 giờ, lần 2 sau 4 giờ, lần 3 sau 12 giờ kèm nhắn Zalo, lần 4 sau 24 giờ.</P>

            <H2>Sắp xếp, chọn cột và lọc</H2>
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mb-2">
              <li><b>Hỗ trợ mới (ưu tiên)</b> — mặc định. Đơn đến hạn xếp xen kẽ 1 khách mới, 1 đơn gọi lại; trong mỗi nhóm đơn to và khách tốt đứng trước.</li>
              <li><b>Kiểu POS (mới nhất trên cùng)</b> — giống danh sách trên POS.</li>
              <li><b>Bấm tiêu đề cột</b> để xếp: lần 1 tăng ▲, lần 2 giảm ▼, lần 3 bỏ.</li>
              <li><b>⚙ Cột hiển thị</b>: bật thêm Mã đơn, Mã vận đơn, Ngày tạo, Sản phẩm, COD, Tỉnh, MKT, Nguồn/page. Trang nhớ lựa chọn trên máy bạn.</li>
              <li>Lọc <b>ngày tạo đơn</b>, <b>đơn nháp</b> (chỉ nháp / ẩn nháp), ô <b>tìm</b> theo tên, SĐT, mã đơn, mã vận đơn.</li>
            </ul>

            <H2>Làm một đơn</H2>
            <P>Bấm vào dòng để mở thẻ đơn bên phải. Thẻ xếp từ trên xuống: đầu thẻ (ĐƠN NHÁP, tên, nút Gọi) → 3 ô kiểm tra (gói khách chọn, uy tín, địa chỉ) → sản phẩm & tiền | giao hàng → phần thu gọn (lịch sử, ghi chú in, thêm thẻ) → thanh kết quả dưới cùng.</P>
            <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-1 mb-2">
              <li>Nhìn đầu thẻ: đơn nháp không, đã gọi mấy lần.</li>
              <li>Liếc 3 ô kiểm tra: gói khớp tiền chưa, khách có hay hoàn không, địa chỉ đủ chưa.</li>
              <li>Bấm <b>📞 Gọi</b>, trao đổi, sửa đơn nếu cần.</li>
              <li>Chọn kết quả, bấm <b>Lưu & đẩy POS</b>.</li>
            </ol>
            <P>Sau khi bấm gọi, nút gọi đơn khác bị khóa tới khi bạn ghi kết quả. Không kết nối được thì bấm <b>Không kết nối được</b> trên thanh đỏ.</P>

            <H2>Các nút kết quả</H2>
            <Table head={["Nút (phím)", "Khi nào", "Trên POS"]} rows={[
              ["Chốt đơn (1)", "Khách đồng ý mua", "Note \"Chốt\" + trạng thái Sale đã chốt. Cần có phường/xã"],
              ["KNM (2)", "Không nghe máy", "Note; đơn quay lại đúng hạn gọi lại"],
              ["Máy bận (3) · Thuê bao (4)", "Máy bận / thuê bao", "Note"],
              ["Đã nhắn Zalo (5)", "Đã nhắn khách qua Zalo", "Note"],
              ["Hẹn gọi lại (6)", "Khách hẹn giờ khác", "Note \"Hẹn gọi HH:mm\" + nhắc hẹn trên POS"],
              ["Hủy đơn (7)", "Khách không mua", "Chọn lý do; note + trạng thái Đã hủy"],
              ["Chỉ ghi note (8)", "Ghi bù cuộc gọi đã qua", "Note theo nội dung bạn gõ"],
            ]} />
            <P>Mỗi lần lưu = đúng 1 note trên POS, gộp kết quả và mọi thay đổi. Thẻ đơn chỉ được gợi ý (nút viền nét đứt), bấm mới gắn; thẻ có sẵn trên POS giữ nguyên.</P>

            <H2>Sửa đơn trong lúc gọi</H2>
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mb-2">
              <li><b>Gói khách chọn</b> đỏ = lệch tiền: hỏi lại khách, đúng gói thì bấm <b>Áp đúng gói</b>.</li>
              <li><b>Sản phẩm</b>: tìm theo tên hoặc mã PHVVN, đổi số lượng, đơn giá; quà tặng = chọn sản phẩm rồi sửa giá về 0.</li>
              <li><b>Tiền</b>: giảm giá, phí ship, miễn ship; đọc đúng số <b>Thu hộ COD</b> cho khách. Giảm trên 15% phải ghi lý do.</li>
              <li><b>Địa chỉ</b>: có gợi ý thì đọc lại với khách rồi bấm <b>Dùng gợi ý</b>. Không có thì chọn <b>Địa chỉ mới</b> (tỉnh → gõ không dấu tên phường/xã) hoặc <b>Địa chỉ cũ (63 tỉnh)</b> (tỉnh cũ → huyện → xã cũ, hệ thống tự đổi sang mới). Gõ số nhà, thôn, tổ.</li>
              <li>Một số xã cũ đã sáp nhập mà POS không tự đổi được: trang sẽ báo, bạn hỏi khách tên phường/xã mới rồi chọn tay.</li>
            </ul>

            <H2>Khách hay bom và các cảnh báo</H2>
            <Table head={["Hiện", "Nghĩa", "Làm gì"]} rows={[
              ["Khách tốt (xanh)", "Từ 3 đơn thành công, hoàn dưới 10%", "Chốt bình thường"],
              ["Bình thường / Khách mới", "Chưa đủ lịch sử", "Xác nhận địa chỉ, giờ nhận"],
              ["⚠ Hay bom / hoàn (đỏ)", "Hoàn từ 30% trở lên hoặc POS cảnh báo", "Xác nhận kỹ, đề nghị chuyển khoản / cọc trước; có thể gắn thẻ \"Rủi ro\""],
            ]} />
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mb-2">
              <li><b>Thanh đỏ "Bạn vừa gọi…"</b>: chưa ghi kết quả cuộc gọi vừa rồi — bấm <b>Ghi kết quả</b>.</li>
              <li><b>Thanh cam "… chưa có note"</b>: tổng đài có cuộc gọi mà đơn chưa có note sau 15 phút — mở đơn, ghi bù bằng <b>Chỉ ghi note</b>.</li>
              <li><b>Thanh xanh "Đang trong khung CSKH"</b> (chỉ Hà): ưu tiên sang trang CSKH.</li>
            </ul>

            <H2>Phím tắt và câu hỏi thường gặp</H2>
            <P>Trong thẻ đơn: phím <b>1–8</b> chọn kết quả, <b>Ctrl + Enter</b> lưu, <b>Esc</b> đóng.</P>
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
              <li><b>Báo "Đơn vừa được sửa trên POS"</b>: đóng thẻ, mở lại rồi sửa lại.</li>
              <li><b>Báo "POS không nhận địa chỉ mới"</b>: chọn lại phường/xã theo địa chỉ mới; các thay đổi khác đã lưu.</li>
              <li><b>Đơn đã chốt trên POS mà quên note</b>: mở từ thanh cam, chọn <b>Chỉ ghi note</b>.</li>
              <li><b>Không thấy đơn</b>: kiểm tra ô chọn sale, lọc ngày, lọc đơn nháp, ô tìm; bấm <b>🔄 Đồng bộ POS</b>. Đơn chưa gán sale không hiện ở đây.</li>
              <li><b>Muốn làm như POS</b>: chọn <b>Kiểu POS</b>, quen dần thì chuyển sang <b>Hỗ trợ mới</b>.</li>
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
