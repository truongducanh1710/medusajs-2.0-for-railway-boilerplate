import { NextRequest } from "next/server"

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""
const MODEL = "qwen/qwen3-235b-a22b"

const SYSTEM_PROMPT = `Bạn là trợ lý tư vấn bán hàng của **Gia Dụng Phan Việt** — cửa hàng gia dụng cao cấp.

## Thông tin cửa hàng
- Hotline: 0967 993 609
- Zalo: https://zalo.me/4385628039049498170
- Website: phanviet.vn
- Giao hàng: Nội thành 1-2 ngày, tỉnh 2-4 ngày
- Thanh toán: COD (thu tiền khi nhận), chuyển khoản QR SePay
- Đổi trả: 7 ngày nếu lỗi nhà sản xuất
- Bảo hành: 12 tháng

## Phong cách tư vấn
- Thân thiện, nhiệt tình, ngắn gọn — không dài dòng
- Dùng tiếng Việt tự nhiên
- Luôn hướng khách đến hành động: xem sản phẩm, đặt hàng, liên hệ Zalo
- Khi khách hỏi giá → báo giá rõ ràng + nhấn mạnh ưu đãi/giảm giá nếu có
- Khi khách phân vân → so sánh lợi ích, đưa ra gợi ý cụ thể
- Khi khách hỏi mua → hướng dẫn bấm "Đặt hàng ngay" trên trang hoặc nhắn Zalo
- Kết thúc câu trả lời ngắn, đừng lặp lại câu hỏi của khách

## Quy tắc
- KHÔNG bịa thông tin sản phẩm không có trong danh sách
- Nếu không biết → mời khách nhắn Zalo 0967 993 609 để tư vấn trực tiếp
- Không nhắc đến đối thủ cạnh tranh
- Trả lời tối đa 3-4 câu, súc tích`

export async function POST(req: NextRequest) {
  try {
    const { messages, productContext } = await req.json()

    // Build system with product context if available
    let systemContent = SYSTEM_PROMPT
    if (productContext) {
      systemContent += `\n\n## Sản phẩm khách đang xem\n${productContext}`
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://phanviet.vn",
        "X-Title": "Phan Viet Chatbot",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemContent },
          ...messages,
        ],
        stream: true,
        max_tokens: 400,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return new Response(JSON.stringify({ error: err }), { status: 500 })
    }

    // Stream response back to client
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value)
            const lines = chunk.split("\n").filter(l => l.startsWith("data: "))
            for (const line of lines) {
              const data = line.slice(6)
              if (data === "[DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                continue
              }
              try {
                const parsed = JSON.parse(data)
                const text = parsed.choices?.[0]?.delta?.content || ""
                if (text) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
                }
              } catch {}
            }
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
