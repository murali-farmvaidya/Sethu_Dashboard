import express from 'express';
import upload from '../middleware/fileUpload.js';
import * as campaignController from '../controllers/campaign.controller.js';

const router = express.Router();

// Create Campaign
router.post('/', upload.single('contactsFile'), campaignController.initiateCampaign);

// List Campaigns
router.get('/', campaignController.getCampaigns);

// Delete (Exclude) Campaign
router.delete('/:campaignId', campaignController.deleteCampaign);

// Get Campaign Call Details
router.get('/:campaignId/calls', campaignController.getCampaignCallDetails);

// Stop/Pause Campaign
router.post('/:campaignId/stop', campaignController.stopCampaign);

// Resume Campaign
router.post('/:campaignId/resume', campaignController.resumeCampaign);

export default router;
