/**
 * User Routes
 * Protected routes for regular user operations
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const userDashboardController = require('../controllers/user.dashboard.controller');
const userSessionsController = require('../controllers/user.sessions.controller');
const userConversationsController = require('../controllers/user.conversations.controller');

// All user routes require authentication
router.use(authenticate);

// Dashboard Routes
router.get('/dashboard', userDashboardController.getUserDashboard);
router.get('/agents/:agentId', userDashboardController.getAgentDetails);

// Session Routes
router.get('/agents/:agentId/sessions', userSessionsController.getAgentSessions);
router.get('/sessions/:sessionId', userSessionsController.getSessionDetails);

// Conversation Routes
router.get('/sessions/:sessionId/conversations', userConversationsController.getSessionConversations);
router.get('/agents/:agentId/conversations', userConversationsController.getAgentConversations);
router.get('/conversations/:conversationId', userConversationsController.getConversationDetails);
router.patch('/conversations/:sessionId/review-status', userConversationsController.updateReviewStatus);

module.exports = router;
