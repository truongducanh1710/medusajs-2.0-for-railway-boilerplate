/**
 * Backfill Pancake orders — one-time historical pull.
 *
 * Usage:
 *   pnpm exec medusa exec ./src/scripts/backfill-pancake.ts
 *   pnpm exec medusa exec ./src/scripts/backfill-pancake.ts -- --from=2024-01-01 --to=2025-09-23
 *
 * - Defaults: from = 2024-01-01, to = today.
 * - Pulls in 30-day chunks to keep each sync job manageable.
 * - Waits for each chunk to finish before starting the next (no concurrent jobs).
 * - force=true → re-syncs all orders (including final states).
 */

import { ExecArgs } from "@medusajs/framework/types"

const CHUNK_DAYS = 30
const POLL_INTERVAL_MS = 5000
const JOB_TIMEOUT_MS = 30 * 60 * 1000

function parseArg(name: string, fallback: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split("=")[1] : fallback
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function waitForJob(syncService: any, jobId: string, logger: any): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < JOB_TIMEOUT_MS) {
    const [job] = await syncService.listPancakeSyncJobs({ id: jobId }, { take: 1 })
    if (!job) throw new Error(`Job ${jobId} not found`)
    if (job.status === "done") {
      logger.info(
        `[Backfill]   ✓ done — orders=${job.total_orders ?? "?"} new=${job.new_orders ?? "?"} updated=${job.updated_orders ?? "?"}`
      )
      return
    }
    if (job.status === "failed") {
      throw new Error(`Job ${jobId} failed: ${job.error ?? "unknown"}`)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Job ${jobId} timed out after ${JOB_TIMEOUT_MS / 60000} minutes`)
}

export default async function backfillPancake({ container }: ExecArgs) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("pancakeSyncModule") as any

  const fromStr = parseArg("from", "2024-01-01")
  const toStr = parseArg("to", fmt(new Date()))

  const overallFrom = new Date(fromStr + "T00:00:00.000Z")
  const overallTo = new Date(toStr + "T23:59:59.999Z")

  if (isNaN(overallFrom.getTime()) || isNaN(overallTo.getTime())) {
    throw new Error(`Invalid date range: ${fromStr} → ${toStr}`)
  }

  logger.info(`[Backfill] Range: ${fmt(overallFrom)} → ${fmt(overallTo)} (chunks: ${CHUNK_DAYS} days, force=true)`)

  let cursor = new Date(overallFrom)
  let chunkNum = 0
  const startedAt = Date.now()

  while (cursor < overallTo) {
    chunkNum++
    const chunkFrom = new Date(cursor)
    const chunkTo = new Date(Math.min(cursor.getTime() + CHUNK_DAYS * 86400_000, overallTo.getTime()))

    logger.info(`[Backfill] Chunk ${chunkNum}: ${fmt(chunkFrom)} → ${fmt(chunkTo)}`)

    try {
      const { jobId } = await syncService.pullByDateRange(chunkFrom, chunkTo, { force: true })
      logger.info(`[Backfill]   jobId=${jobId}`)
      await waitForJob(syncService, jobId, logger)
    } catch (err: any) {
      if (err.code === "SYNC_IN_PROGRESS") {
        logger.warn(`[Backfill]   Sync busy, waiting 30s then retrying chunk ${chunkNum}`)
        await new Promise((r) => setTimeout(r, 30000))
        continue
      }
      logger.error(`[Backfill]   ✗ Chunk ${chunkNum} failed: ${err.message}`)
      throw err
    }

    cursor = new Date(chunkTo.getTime() + 1)
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
  logger.info(`[Backfill] ✅ Done — ${chunkNum} chunks in ${elapsedMin} min`)
}
