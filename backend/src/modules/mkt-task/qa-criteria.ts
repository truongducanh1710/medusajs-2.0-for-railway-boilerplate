// Bộ tiêu chí QA — nguồn sự thật dùng chung cho API và UI admin.
// Mỗi dept có đúng 6 tiêu chí ánh xạ vào cột c1..c6 của qa_weekly_score, tổng 100 điểm.
// Dựa trên Thông báo BGĐ hiệu lực 12/07/2026 (Điều 2: Sale, Điều 3: Vận Đơn).

export type QaCriterion = { key: "c1" | "c2" | "c3" | "c4" | "c5" | "c6"; label: string; max: number; hint: string }

export const QA_CRITERIA: Record<string, QaCriterion[]> = {
  van_don: [
    { key: "c1", label: "Xử lý đơn đúng thời gian", max: 35, hint: "Duyệt đơn, cấu hình NVC chuẩn trong khung giờ. Không ngâm/dồn đơn, xử lý đơn treo >24h." },
    { key: "c2", label: "Note trạng thái & gắn thẻ", max: 15, hint: "Note trung thực lịch sử xử lý; gắn đúng tag lỗi (kho/khách/bưu tá) để đối soát." },
    { key: "c3", label: "Nghe hotline", max: 15, hint: "Không nhỡ cuộc gọi inbound; xử lý khiếu nại giao chậm/đổi thông tin chuyên nghiệp." },
    { key: "c4", label: "Phối hợp bộ phận khác", max: 10, hint: "Hỗ trợ đơn hủy/hoàn sàn TikTok, gọi thuyết phục khách, báo lỗi hệ thống diện rộng." },
    { key: "c5", label: "CSKH cũ", max: 10, hint: "Gọi lại 100% data cũ được bàn giao trong ngày; đeo bám đúng hẹn follow-up, làm sạch data." },
    { key: "c6", label: "Thái độ làm việc", max: 15, hint: "Tuân thủ quy trình (5) · Báo cáo đúng hạn (5) · Làm việc nhóm (5)." },
  ],
  sale: [
    { key: "c1", label: "Xử lý data", max: 35, hint: "Tiếp nhận & gọi data mới đúng SLA. Khai thác đúng nhu cầu, tư vấn đúng khuyến mãi, khảo sát chính xác." },
    { key: "c2", label: "Chủ động up-sale", max: 20, hint: "100% cuộc gọi có gợi mở SP bổ trợ/combo lớn hơn, đúng nhu cầu, tối ưu giá trị đơn." },
    { key: "c3", label: "Chuyển trạng thái", max: 10, hint: "Cập nhật trạng thái đơn trên CRM ngay sau cuộc gọi (chờ xác nhận / đã chốt / hủy...)." },
    { key: "c4", label: "Gắn thẻ", max: 10, hint: "Phân khúc khách bằng tag (VIP, khó tính, lý do hủy...). Không bỏ sót gắn tag." },
    { key: "c5", label: "Phòng chống hoàn hủy", max: 10, hint: "Tư vấn đúng thông tin SP, ngày giao, bảo hành; phối hợp kho xử lý." },
    { key: "c6", label: "Thái độ làm việc", max: 15, hint: "Tuân thủ quy trình (5) · Báo cáo đúng hạn (5) · Làm việc nhóm (5)." },
  ],
}

export const DEPT_LABELS: Record<string, string> = { van_don: "Vận Đơn", sale: "Sale" }

// Quy đổi điểm QA → xếp loại + % thưởng (Điều 4).
export function gradeOf(score: number): { grade: string; bonus: number; tone: "good" | "warn" | "bad" } {
  if (score >= 90) return { grade: "Xuất sắc", bonus: 100, tone: "good" }
  if (score >= 80) return { grade: "Khá", bonus: 90, tone: "good" }
  if (score >= 70) return { grade: "Trung bình", bonus: 75, tone: "warn" }
  return { grade: "Không đạt", bonus: 50, tone: "bad" }
}

// Tổng điểm 6 tiêu chí, đã áp lỗi liệt (fatal → 0).
export function computeTotal(row: { c1: number; c2: number; c3: number; c4: number; c5: number; c6: number; fatal_flag?: boolean }): number {
  if (row.fatal_flag) return 0
  return (row.c1 || 0) + (row.c2 || 0) + (row.c3 || 0) + (row.c4 || 0) + (row.c5 || 0) + (row.c6 || 0)
}
