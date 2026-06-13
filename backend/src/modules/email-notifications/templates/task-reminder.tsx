import { Section, Text, Button, Hr } from '@react-email/components'
import { Base } from './base'

export const TASK_REMINDER = 'task-reminder'

export interface TaskReminderEmailProps {
  taskTitle: string
  assigneeName: string
  deadline: string
  taskUrl: string
  type: 'task_assigned' | 'deadline_2h' | 'pending_review' | 'review_done' | 'review_rejected'
}

export const isTaskReminderData = (data: any): data is TaskReminderEmailProps =>
  typeof data.taskTitle === 'string' && typeof data.taskUrl === 'string'

const MESSAGES: Record<TaskReminderEmailProps['type'], { subject: string; body: string }> = {
  task_assigned:    { subject: '📋 Bạn có task mới',     body: 'được giao task mới' },
  deadline_2h:      { subject: '⏰ Deadline còn 2 giờ',  body: 'còn khoảng 2 giờ để hoàn thành task' },
  pending_review:   { subject: '🔍 Task chờ duyệt',      body: 'đã gửi yêu cầu duyệt cho task' },
  review_done:      { subject: '✅ Task đã được duyệt',   body: 'đã được duyệt' },
  review_rejected:  { subject: '❌ Task bị từ chối',      body: 'đã bị từ chối' },
}

export const TaskReminderEmail = ({ taskTitle, assigneeName, deadline, taskUrl, type }: TaskReminderEmailProps) => {
  const msg = MESSAGES[type] || MESSAGES.task_assigned
  return (
    <Base preview={`${msg.subject}: ${taskTitle}`}>
      <Section className="mt-[32px] text-center">
        <Text style={{ fontSize: 32 }}>{msg.subject.split(' ')[0]}</Text>
        <Text className="text-black text-[16px] font-semibold leading-[24px]">{taskTitle}</Text>
        <Text className="text-[#555] text-[14px] leading-[22px]">
          {assigneeName} {msg.body}.<br />
          Deadline: <strong>{deadline}</strong>
        </Text>
        <Section className="mt-4 mb-[32px]">
          <Button className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline px-5 py-3" href={taskUrl}>
            Xem task
          </Button>
        </Section>
      </Section>
      <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
      <Text className="text-[#666666] text-[12px] leading-[24px]">Phan Viet MKT Tasks</Text>
    </Base>
  )
}

export default TaskReminderEmail
