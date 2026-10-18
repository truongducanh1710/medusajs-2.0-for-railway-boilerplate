import { GET, POST } from "../overtime/route"
import { PATCH } from "../overtime/[id]/decision/route"
import { GET as getCheckin, POST as checkOut } from "../checkin/route"
import { getCurrentUserEmail, userHasPerm } from "../_lib"

jest.mock("../_lib", () => ({ getCurrentUserEmail: jest.fn(), userHasPerm: jest.fn() }))
jest.mock("../../mkt-chat/_presence", () => ({ vnDayKey: () => "2026-10-18" }))

const currentEmail = getCurrentUserEmail as jest.Mock
const hasPerm = userHasPerm as jest.Mock

function context(body: any = {}) {
  const svc = {
    listOvertimeRequests: jest.fn().mockResolvedValue([]),
    createOvertimeRequests: jest.fn().mockImplementation(async (data) => ({ id: "ot_1", ...data })),
    updateOvertimeRequests: jest.fn().mockImplementation(async (data) => data),
    listChamCongConfigs: jest.fn().mockResolvedValue([{ checkin_open: "08:00", checkin_cutoff: "21:00" }]),
    listChamCongLogs: jest.fn().mockResolvedValue([]),
    createChamCongLogs: jest.fn().mockResolvedValue({ id: "log_1", action: "out" }),
  }
  const req: any = { body, query: {}, params: { id: "ot_1" }, scope: { resolve: () => svc } }
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }
  return { svc, req, res }
}

const registration = { day_key: "2026-10-18", duration_min: 90, note: "  Hoàn thành báo cáo  " }

beforeEach(() => {
  jest.clearAllMocks()
  currentEmail.mockResolvedValue("employee@phanviet.vn")
  hasPerm.mockResolvedValue(false)
  jest.useFakeTimers().setSystemTime(new Date("2026-10-18T12:00:00+07:00"))
})
afterEach(() => jest.useRealTimers())

test("an employee registers for themselves without approval rights", async () => {
  const { req, res, svc } = context({ ...registration, source: "manual", status: "approved", reviewer_email: "boss" })
  await POST(req, res)
  expect(svc.createOvertimeRequests).toHaveBeenCalledWith({
    user_email: "employee@phanviet.vn", day_key: "2026-10-18", duration_min: 90,
    note: "Hoàn thành báo cáo", source: "employee", status: "pending",
  })
  expect(res.json).toHaveBeenCalledWith({ request: expect.objectContaining({ status: "pending" }) })
})

test("unauthenticated registrations are rejected", async () => {
  currentEmail.mockResolvedValue(null)
  const { req, res, svc } = context(registration)
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(401)
  expect(svc.createOvertimeRequests).not.toHaveBeenCalled()
})

test("an employee cannot register for someone else", async () => {
  const { req, res, svc } = context({ ...registration, user_email: "other@phanviet.vn" })
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(403)
  expect(svc.createOvertimeRequests).not.toHaveBeenCalled()
})

test("HR can continue registering for another employee", async () => {
  hasPerm.mockResolvedValue(true)
  const { req, svc } = context({ ...registration, user_email: "other@phanviet.vn" })
  await POST(req, context().res)
  expect(svc.createOvertimeRequests).toHaveBeenCalledWith(expect.objectContaining({
    user_email: "other@phanviet.vn", source: "manual", status: "pending",
  }))
})

test.each([0, -1, 0.4, 90.5, 1441, NaN, Infinity, "90", null])("rejects invalid requested minutes %s", async (duration_min) => {
  const { req, res, svc } = context({ ...registration, duration_min })
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(400)
  expect(svc.createOvertimeRequests).not.toHaveBeenCalled()
})

test.each(["2026-02-30", "2026-13-01", "18/10/2026", "", null])("rejects an invalid calendar date %s", async (day_key) => {
  const { req, res, svc } = context({ ...registration, day_key })
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(400)
  expect(svc.createOvertimeRequests).not.toHaveBeenCalled()
})

test.each([undefined, "   ", "x".repeat(501), {}])("requires a valid reason for self registration", async (note) => {
  const { req, res, svc } = context({ ...registration, note })
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(400)
  expect(svc.createOvertimeRequests).not.toHaveBeenCalled()
})

test("does not replace an existing day's OT", async () => {
  const { req, res, svc } = context(registration)
  svc.listOvertimeRequests.mockResolvedValue([{ id: "existing", status: "approved" }])
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(409)
  expect(svc.createOvertimeRequests).not.toHaveBeenCalled()
  expect(svc.updateOvertimeRequests).not.toHaveBeenCalled()
})

test("reports a conflict for concurrent registrations", async () => {
  const { req, res, svc } = context(registration)
  svc.createOvertimeRequests.mockRejectedValue({ code: "23505" })
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(409)
})

test("employees only list their own OT", async () => {
  const { req, svc, res } = context()
  await GET(req, res)
  expect(svc.listOvertimeRequests).toHaveBeenCalledWith(
    { user_email: "employee@phanviet.vn", deleted_at: null }, expect.anything())
})

test("employees cannot list the team approval queue", async () => {
  const { req, res, svc } = context()
  req.query.scope = "pending"
  await GET(req, res)
  expect(res.status).toHaveBeenCalledWith(403)
  expect(svc.listOvertimeRequests).not.toHaveBeenCalled()
})

test("employees cannot approve their own OT", async () => {
  const { req, res, svc } = context({ decision: "approved" })
  await PATCH(req, res)
  expect(res.status).toHaveBeenCalledWith(403)
  expect(svc.updateOvertimeRequests).not.toHaveBeenCalled()
})

test("managers approve the employee's requested minutes", async () => {
  hasPerm.mockResolvedValue(true)
  const { req, res, svc } = context({ decision: "approved" })
  svc.listOvertimeRequests.mockResolvedValue([{ id: "ot_1", status: "pending", duration_min: 90, source: "employee" }])
  await PATCH(req, res)
  expect(svc.updateOvertimeRequests).toHaveBeenCalledWith(expect.objectContaining({
    id: "ot_1", status: "approved", approved_duration_min: 90, reviewer_email: "employee@phanviet.vn",
  }))
})

test.each([0, -1, 1.5, 1441, Infinity])("rejects invalid manager adjustment %s", async (approved_duration_min) => {
  hasPerm.mockResolvedValue(true)
  const { req, res, svc } = context({ decision: "approved", approved_duration_min })
  await PATCH(req, res)
  expect(res.status).toHaveBeenCalledWith(400)
  expect(svc.updateOvertimeRequests).not.toHaveBeenCalled()
})

test.each(["pending", "rejected"])("%s OT does not allow early checkin", async (status) => {
  jest.setSystemTime(new Date("2026-10-18T07:00:00+07:00"))
  const { req, res, svc } = context()
  svc.listOvertimeRequests.mockResolvedValue([{ status, source: "employee" }])
  await getCheckin(req, res)
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ window: expect.objectContaining({ allowed: false }) }))
})

test("approved OT allows early checkin", async () => {
  jest.setSystemTime(new Date("2026-10-18T07:00:00+07:00"))
  const { req, res, svc } = context()
  svc.listOvertimeRequests.mockResolvedValue([{ status: "approved", source: "employee" }])
  await getCheckin(req, res)
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ window: expect.objectContaining({ allowed: true, early_by_ot: true }) }))
})

test("checkout records attendance without creating or updating OT", async () => {
  jest.setSystemTime(new Date("2026-10-18T20:00:00+07:00"))
  const { req, res, svc } = context({ action: "out", lat: 21.03, lng: 105.85 })
  await checkOut(req, res)
  expect(svc.createChamCongLogs).toHaveBeenCalled()
  expect(res.json).toHaveBeenCalledWith({ log: { id: "log_1", action: "out" } })
  expect(svc.listOvertimeRequests).not.toHaveBeenCalled()
  expect(svc.createOvertimeRequests).not.toHaveBeenCalled()
  expect(svc.updateOvertimeRequests).not.toHaveBeenCalled()
})
