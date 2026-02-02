/**
 * Setup Routes
 * Routes for system initialization
 */

const express = require('express');
const router = express.Router();
const setupController = require('../controllers/setup.controller');

// Public routes for initial setup
router.post('/init', setupController.initializeSystem);
router.get('/status', setupController.getSystemStatus);

module.exports = router;
