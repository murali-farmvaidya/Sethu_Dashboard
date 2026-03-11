import express from 'express';
import * as exotelController from '../controllers/exotel.controller.js';

const router = express.Router();

// Public Webhooks (No Auth Token required, secured by obscurity/IP whitelist ideally)
router.all('/incoming', exotelController.handleIncoming); // Support GET & POST
router.all('/callback', exotelController.handleStatusCallback);
router.all('/reject', exotelController.handleReject);
router.all('/credit-check', exotelController.handleCreditCheck); // For Passthru Applet
router.all('/passthru', exotelController.handlePassthru); // Capture missed calls/errors

export default router;
