import { MedusaService } from "@medusajs/framework/utils"
import MktTask from "./models/mkt-task"
import MktChannel from "./models/mkt-channel"
import MktMessage from "./models/mkt-message"
import MktPresenceSession from "./models/mkt-presence-session"
import AdsExpenseTransaction from "./models/ads-expense-transaction"
import ChamCongLog from "./models/cham-cong-log"
import LeaveRequest from "./models/leave-request"
import ChamCongConfig from "./models/cham-cong-config"
import EmployeeProfile from "./models/employee-profile"
import QaDailyNote from "./models/qa-daily-note"
import QaWeeklyScore from "./models/qa-weekly-score"
import OvertimeRequest from "./models/overtime-request"
import LeaveBalance from "./models/leave-balance"

class MktTaskModuleService extends MedusaService({ MktTask, MktChannel, MktMessage, MktPresenceSession, AdsExpenseTransaction, ChamCongLog, LeaveRequest, ChamCongConfig, EmployeeProfile, QaDailyNote, QaWeeklyScore, OvertimeRequest, LeaveBalance }) {}

export default MktTaskModuleService
