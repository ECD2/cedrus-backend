import { Router } from 'express';
const router = Router();
router.get('/', (req, res) => res.status(200).json({ ok: true, service: 'cedrus' }));
export default router;
