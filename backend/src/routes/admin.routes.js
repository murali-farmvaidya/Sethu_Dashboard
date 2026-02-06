/**
 * Admin Routes
 * Protected routes for admin-only operations
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middleware/auth');
const adminUserController = require('../controllers/admin.user.controller');
const adminAgentController = require('../controllers/admin.agent.controller');
const adminStatsController = require('../controllers/admin.stats.controller');
const adminPermissionsController = require('../controllers/admin.permissions.controller');

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(authorizeRoles('admin'));

// User Management Routes
router.get('/users', adminUserController.getAllUsers);
router.get('/users/:userId', adminUserController.getUserById);
router.post('/users', adminUserController.createUser);
router.put('/users/:userId', adminUserController.updateUser);
router.delete('/users/:userId', adminUserController.deleteUser);
router.patch('/users/:userId/toggle-active', adminUserController.toggleUserActive);
router.post('/users/:userId/reset-password', adminUserController.sendPasswordReset);

// Agent Management Routes
router.get('/agents', adminAgentController.getAllAgents);

// Agent Assignment Routes
router.get('/users/:userId/agents', adminAgentController.getUserAgentAssignments);
router.post('/users/:userId/agents', adminAgentController.assignAgentToUser);
router.post('/users/:userId/agents/bulk', adminAgentController.bulkAssignAgents);
router.put('/users/:userId/agents/:agentId', adminAgentController.updateAgentAssignment);
router.delete('/users/:userId/agents/:agentId', adminAgentController.removeAgentAssignment);

// Mark Permission Management Routes
router.get('/mark-permissions', adminPermissionsController.getMarkPermissions);
router.post('/users/:userId/agents/:agentId/mark-permission', adminPermissionsController.toggleMarkPermission);

// Admin Statistics & Monitoring
router.get('/stats', adminStatsController.getAdminStats);
router.get('/audit-logs', adminStatsController.getAuditLogs);

module.exports = router;
