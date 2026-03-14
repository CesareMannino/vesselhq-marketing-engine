const express = require('express');
const postController = require('../controllers/postController');

const router = express.Router();

router.get('/', postController.getPostHistory);
router.get('/ui', postController.getPostHistoryUi);

module.exports = router;
