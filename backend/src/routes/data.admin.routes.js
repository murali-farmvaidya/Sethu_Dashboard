/**
 * Data Admin Routes
 * Protected routes for data management (super admin only)
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middleware/auth');
const dataAdminController = require('../controllers/data.admin.controller');

// All data admin routes require authentication and admin role
router.use(authenticate);
router.use(authorizeRoles('admin'));

// Delete operations
router.delete('/sessions/:sessionId', dataAdminController.deleteSession);
router.delete('/conversations/:sessionId', dataAdminController.deleteConversation);
router.delete('/agents/:agentId', dataAdminController.deleteAgent);

// Update operations
router.patch('/conversations/:sessionId/summary', dataAdminController.updateSummary);

// Exclusion management
router.get('/excluded', dataAdminController.getExcludedItems);
router.delete('/excluded/:itemType/:itemId', dataAdminController.restoreExcludedItem);

module.exports = router;
