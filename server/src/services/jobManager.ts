// Job Manager - Background processing for email analysis
import { v4 as uuidv4 } from 'uuid';

export interface JobProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  currentTask: string;
}

export interface EmailPreview {
  id: string;
  subject: string;
  sender: string;
  snippet?: string;
}

export interface ProcessedOrder {
  id: string;
  supplier: string;
  orderDate: string;
  totalAmount: number;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
  }>;
  confidence: number;
}

export interface Job {
  id: string;
  userId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: JobProgress;
  currentEmail: EmailPreview | null;
  orders: ProcessedOrder[];
  logs: string[];
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

// In-memory job storage (would be Redis/DB in production)
const jobs = new Map<string, Job>();
const userJobs = new Map<string, string>(); // userId -> jobId (latest)

export function createJob(userId: string): Job {
  // Cancel any existing running job for this user
  const existingJobId = userJobs.get(userId);
  if (existingJobId) {
    const existingJob = jobs.get(existingJobId);
    if (existingJob && existingJob.status === 'running') {
      existingJob.status = 'failed';
      existingJob.error = 'Cancelled - new job started';
      existingJob.updatedAt = new Date();
    }
  }

  const job: Job = {
    id: uuidv4(),
    userId,
    status: 'pending',
    progress: {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      currentTask: 'Queued...',
    },
    currentEmail: null,
    orders: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  jobs.set(job.id, job);
  userJobs.set(userId, job.id);

  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function getJobForUser(userId: string): Job | undefined {
  const jobId = userJobs.get(userId);
  if (jobId) {
    return jobs.get(jobId);
  }
  return undefined;
}

export function updateJob(jobId: string, updates: Partial<Job>): Job | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  Object.assign(job, updates, { updatedAt: new Date() });
  return job;
}

export function addJobLog(jobId: string, message: string): void {
  const job = jobs.get(jobId);
  if (job) {
    const timestamp = new Date().toLocaleTimeString();
    job.logs.unshift(`[${timestamp}] ${message}`);
    job.updatedAt = new Date();
    // Keep only last 100 logs
    if (job.logs.length > 100) {
      job.logs = job.logs.slice(0, 100);
    }
  }
}

export function addJobOrder(jobId: string, order: ProcessedOrder): void {
  const job = jobs.get(jobId);
  if (job) {
    job.orders.push(order);
    job.updatedAt = new Date();
  }
}

export function setJobCurrentEmail(jobId: string, email: EmailPreview | null): void {
  const job = jobs.get(jobId);
  if (job) {
    job.currentEmail = email;
    job.updatedAt = new Date();
  }
}

export function updateJobProgress(jobId: string, progress: Partial<JobProgress>): void {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job.progress, progress);
    job.updatedAt = new Date();
  }
}

// Cleanup old jobs (jobs older than 1 hour)
export function cleanupOldJobs(): void {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [jobId, job] of jobs.entries()) {
    if (job.updatedAt < oneHourAgo && job.status !== 'running') {
      jobs.delete(jobId);
      // Clean up user mapping if this was their latest job
      if (userJobs.get(job.userId) === jobId) {
        userJobs.delete(job.userId);
      }
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldJobs, 10 * 60 * 1000);

export const jobManager = {
  createJob,
  getJob,
  getJobForUser,
  updateJob,
  addJobLog,
  addJobOrder,
  setJobCurrentEmail,
  updateJobProgress,
  cleanupOldJobs,
};
