const express = require('express');
const supportController = require('../controllers/support.controller');

const router = express.Router();

// Permite enviar tickets tanto con auth como sin ella (ej. problemas de login)
router.post('/', supportController.submitTicket);

module.exports = router;
