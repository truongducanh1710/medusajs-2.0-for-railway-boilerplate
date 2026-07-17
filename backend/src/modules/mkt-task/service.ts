import { MedusaService } from "@medusajs/framework/utils"
import MktTask from "./models/mkt-task"
import MktChannel from "./models/mkt-channel"
import MktMessage from "./models/mkt-message"
import MktPresenceSession from "./models/mkt-presence-session"
import AdsExpenseTransaction from "./models/ads-expense-transaction"
import ChamCongLog from "./models/cham-cong-log"
import LeaveRequest from "./models/leave-request"

class MktTaskModuleService extends MedusaService({ MktTask, MktChannel, MktMessage, MktPresenceSession, AdsExpenseTransaction, ChamCongLog, LeaveRequest }) {}

export default MktTaskModuleService
