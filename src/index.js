import express from 'express';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import smsRouter from './routes/sms.js';
import healthRouter from './routes/health.js';
import { startScheduler } from './jobs/scheduler.js';

const app = express();
// Twilio posts application/x-www-form-urlencoded; JSON is for future web/Stripe webhooks
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use('/health', healthRouter);
app.use('/sms', smsRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', err);
  res.status(500).send('Internal error');
});

app.listen(config.port, () => {
  logger.info(`Cedrus backend listening on :${config.port}`);
  if (config.enableJobs) startScheduler();
  else logger.info('Jobs disabled on this instance (ENABLE_JOBS=false)');
});
