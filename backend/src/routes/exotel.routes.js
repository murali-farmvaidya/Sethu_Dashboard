const express = require('express');
const router = express.Router();
const ExotelController = require('../controllers/ExotelController');

// Exotel calls this
router.post('/incoming', ExotelController.handleIncoming);
router.post('/callback', ExotelController.handleStatusCallback);
router.all('/passthru', ExotelController.handlePassthru); // Handle GET/POST

module.exports = router;
